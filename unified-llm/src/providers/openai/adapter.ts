import type { Request } from "../../types/request.js";
import type { Response } from "../../types/response.js";
import type { StreamEvent } from "../../types/stream-event.js";
import type { ProviderAdapter } from "../../types/provider-adapter.js";
import type { AdapterTimeout } from "../../types/timeout.js";
import {
  SDKError,
  ProviderError,
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContextLengthError,
  ContentFilterError,
  QuotaExceededError,
  RequestTimeoutError,
} from "../../types/errors.js";
import { classifyByMessage } from "../../utils/error-classify.js";
import { httpRequest, httpRequestStream, parseRetryAfterHeader } from "../../utils/http.js";
import { parseSSE } from "../../utils/sse.js";
import { str, rec } from "../../utils/extract.js";
import { translateRequest } from "./request-translator.js";
import { resolveFileImages } from "../../utils/resolve-file-images.js";
import { translateResponse } from "./response-translator.js";
import { translateStream } from "./stream-translator.js";

export interface OpenAIAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  orgId?: string;
  projectId?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: AdapterTimeout;
}

function extractErrorMessage(body: unknown): string {
  const obj = rec(body);
  if (obj) {
    const errorObj = rec(obj["error"]);
    if (errorObj && typeof errorObj["message"] === "string") {
      return errorObj["message"];
    }
  }
  return typeof body === "string" ? body : JSON.stringify(body);
}

function extractErrorCode(body: unknown): string | undefined {
  const obj = rec(body);
  if (obj) {
    const errorObj = rec(obj["error"]);
    if (errorObj) {
      if (typeof errorObj["code"] === "string") return errorObj["code"];
      if (typeof errorObj["type"] === "string") return errorObj["type"];
    }
  }
  return undefined;
}

function extractRetryAfter(body: unknown, headers: Headers): number | undefined {
  // Prefer Retry-After header (supports both numeric seconds and HTTP-date)
  const fromHeader = parseRetryAfterHeader(headers);
  if (fromHeader !== undefined) {
    return fromHeader;
  }
  // Fall back to body field
  const obj = rec(body);
  if (obj) {
    const errorObj = rec(obj["error"]);
    if (errorObj && typeof errorObj["retry_after"] === "number") {
      return errorObj["retry_after"];
    }
  }
  return undefined;
}

function mapError(
  status: number,
  body: unknown,
  provider: string,
  headers: Headers,
): SDKError | undefined {
  const message = extractErrorMessage(body);
  const errorCode = extractErrorCode(body);

  switch (status) {
    case 400: {
      const classification = classifyByMessage(message);
      if (classification === "context_length") {
        return new ContextLengthError(message, provider, errorCode, body);
      }
      if (classification === "content_filter") {
        return new ContentFilterError(message, provider, errorCode, body);
      }
      return new InvalidRequestError(message, provider, errorCode, body);
    }
    case 401:
      return new AuthenticationError(message, provider, errorCode, body);
    case 403:
      return new AccessDeniedError(message, provider, errorCode, body);
    case 404:
      return new NotFoundError(message, provider, errorCode, body);
    case 408:
      return new RequestTimeoutError(message);
    case 413:
      return new ContextLengthError(message, provider, errorCode, body);
    case 422:
      return new InvalidRequestError(message, provider, errorCode, body);
    case 429: {
      const retryAfter = extractRetryAfter(body, headers);
      return new RateLimitError(message, provider, errorCode, retryAfter, body);
    }
    default:
      if (status >= 500) {
        return new ServerError(message, provider, errorCode, status, body);
      }
      break;
  }

  const classification = classifyByMessage(message);
  if (classification === "content_filter") {
    return new ContentFilterError(message, provider, errorCode, body);
  }
  if (classification === "quota") {
    return new QuotaExceededError(message, provider, errorCode, body);
  }
  if (classification === "not_found") {
    return new NotFoundError(message, provider, errorCode, body);
  }
  if (classification === "auth") {
    return new AuthenticationError(message, provider, errorCode, body);
  }
  return undefined;
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";
  readonly supportsNativeJsonSchema = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly orgId?: string;
  private readonly projectId?: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout?: AdapterTimeout;

  constructor(options: OpenAIAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.orgId = options.orgId;
    this.projectId = options.projectId;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeout = options.timeout;
  }

  private buildHeaders(
    extraHeaders: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
      ...extraHeaders,
    };

    if (this.orgId) {
      headers["OpenAI-Organization"] = this.orgId;
    }
    if (this.projectId) {
      headers["OpenAI-Project"] = this.projectId;
    }

    return headers;
  }

  async complete(request: Request): Promise<Response> {
    const resolved = await resolveFileImages(request);
    const { body, headers: extraHeaders, warnings } = translateRequest(resolved, false);
    const url = `${this.baseUrl}/v1/responses`;
    const timeout = request.timeout ?? this.timeout;

    const httpResponse = await httpRequest({
      url,
      method: "POST",
      headers: this.buildHeaders(extraHeaders),
      body,
      timeout,
      signal: request.abortSignal,
      mapError,
      provider: this.name,
    });

    const responseBody = rec(httpResponse.body) ?? {};
    const result = translateResponse(responseBody, httpResponse.rateLimit);
    if (warnings.length > 0) {
      result.warnings = [...result.warnings, ...warnings];
    }
    return result;
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    const resolved = await resolveFileImages(request);
    const { body, headers: extraHeaders } = translateRequest(resolved, true);
    const url = `${this.baseUrl}/v1/responses`;
    const timeout = request.timeout ?? this.timeout;

    const { body: streamBody } = await httpRequestStream({
      url,
      method: "POST",
      headers: this.buildHeaders(extraHeaders),
      body,
      timeout,
      signal: request.abortSignal,
      mapError,
      provider: this.name,
    });

    const sseEvents = parseSSE(streamBody);
    yield* translateStream(sseEvents);
  }

  supportsToolChoice(mode: string): boolean {
    return ["auto", "none", "required", "named"].includes(mode);
  }

  async initialize(): Promise<void> {
    // No initialization needed for HTTP-based adapter
  }

  async close(): Promise<void> {
    // No cleanup needed for HTTP-based adapter
  }
}
