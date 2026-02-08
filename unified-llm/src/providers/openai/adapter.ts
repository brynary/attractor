import type { Request } from "../../types/request.js";
import type { Response } from "../../types/response.js";
import type { StreamEvent } from "../../types/stream-event.js";
import type { ProviderAdapter } from "../../types/provider-adapter.js";
import type { AdapterTimeout } from "../../types/timeout.js";
import {
  ProviderError,
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContextLengthError,
} from "../../types/errors.js";
import { httpRequest, httpRequestStream } from "../../utils/http.js";
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

function extractRetryAfter(body: unknown, headers: Headers): number | undefined {
  // Prefer Retry-After header over body field
  const headerValue = headers.get("retry-after");
  if (headerValue !== null) {
    const seconds = Number(headerValue);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds;
    }
  }
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
): ProviderError | undefined {
  const message = extractErrorMessage(body);

  switch (status) {
    case 400: {
      const lower = message.toLowerCase();
      if (
        lower.includes("context length") ||
        lower.includes("too many tokens") ||
        lower.includes("maximum context")
      ) {
        return new ContextLengthError(message, provider, body);
      }
      return new InvalidRequestError(message, provider, body);
    }
    case 401:
      return new AuthenticationError(message, provider, body);
    case 403:
      return new AccessDeniedError(message, provider, body);
    case 404:
      return new NotFoundError(message, provider, body);
    case 429: {
      const retryAfter = extractRetryAfter(body, headers);
      return new RateLimitError(message, provider, retryAfter, body);
    }
    default:
      if (status >= 500) {
        return new ServerError(message, provider, status, body);
      }
      return undefined;
  }
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
    const { body, headers: extraHeaders } = translateRequest(resolved, false);
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
    return translateResponse(responseBody, httpResponse.rateLimit);
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
}
