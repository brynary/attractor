import type { Request } from "../../types/request.js";
import type { Response } from "../../types/response.js";
import type { StreamEvent } from "../../types/stream-event.js";
import type { ProviderAdapter } from "../../types/provider-adapter.js";
import type { AdapterTimeout } from "../../types/timeout.js";
import {
  SDKError,
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
import { mapGrpcStatusToError } from "../../utils/grpc-errors.js";

export interface GeminiAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: AdapterTimeout;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

function mapError(
  status: number,
  body: unknown,
  provider: string,
  headers: Headers,
): SDKError | undefined {
  const errorBody = rec(body);
  const errorObj = rec(errorBody?.["error"]);
  const message = str(
    errorObj?.["message"],
    typeof body === "string" ? body : "Unknown error",
  );
  const errorCode = typeof errorObj?.["status"] === "string"
    ? errorObj["status"]
    : typeof errorObj?.["code"] === "string"
      ? errorObj["code"]
      : undefined;

  switch (status) {
    case 401:
      return new AuthenticationError(message, provider, errorCode, body);
    case 403:
      return new AccessDeniedError(message, provider, errorCode, body);
    case 404:
      return new NotFoundError(message, provider, errorCode, body);
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
    case 408:
      return new RequestTimeoutError(message);
    case 413:
      return new ContextLengthError(message, provider, errorCode, body);
    case 422:
      return new InvalidRequestError(message, provider, errorCode, body);
    case 429: {
      const retryAfter = parseRetryAfterHeader(headers);
      return new RateLimitError(message, provider, errorCode, retryAfter, body);
    }
    default:
      if (status >= 500) {
        return new ServerError(message, provider, errorCode, status, body);
      }
      break;
  }

  if (errorCode) {
    const grpcMapped = mapGrpcStatusToError(errorCode, message, provider, status, body, headers);
    if (grpcMapped) {
      return grpcMapped;
    }
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

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";
  readonly supportsNativeJsonSchema = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: AdapterTimeout | undefined;

  constructor(options: GeminiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeout = options.timeout;
  }

  async complete(request: Request): Promise<Response> {
    const resolved = await resolveFileImages(request);
    const { body, warnings } = translateRequest(resolved);

    const url = `${this.baseUrl}/v1beta/models/${request.model}:generateContent?key=${this.apiKey}`;
    const headers = this.buildHeaders();
    const timeout = request.timeout ?? this.timeout;

    const response = await httpRequest({
      url,
      method: "POST",
      headers,
      body,
      timeout,
      signal: request.abortSignal,
      mapError,
      provider: this.name,
    });

    const responseBody = rec(response.body) ?? {};
    const result = translateResponse(responseBody, response.rateLimit);
    result.warnings = [...result.warnings, ...warnings];
    return result;
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    const resolved = await resolveFileImages(request);
    const { body } = translateRequest(resolved);

    const url = `${this.baseUrl}/v1beta/models/${request.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const headers = this.buildHeaders();
    const timeout = request.timeout ?? this.timeout;

    const response = await httpRequestStream({
      url,
      method: "POST",
      headers,
      body,
      timeout,
      signal: request.abortSignal,
      mapError,
      provider: this.name,
    });

    const sseEvents = parseSSE(response.body);
    yield* translateStream(sseEvents);
  }

  supportsToolChoice(mode: string): boolean {
    return (
      mode === "auto" ||
      mode === "none" ||
      mode === "required" ||
      mode === "named"
    );
  }

  async initialize(): Promise<void> {
    // No initialization needed for HTTP-based adapter
  }

  async close(): Promise<void> {
    // No cleanup needed for HTTP-based adapter
  }

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...this.defaultHeaders,
    };
  }
}
