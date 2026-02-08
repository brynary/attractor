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
  ProviderError,
} from "../../types/errors.js";
import { classifyByMessage } from "../../utils/error-classify.js";
import { httpRequest, httpRequestStream, parseRetryAfterHeader } from "../../utils/http.js";
import { parseSSE } from "../../utils/sse.js";
import { str, rec } from "../../utils/extract.js";
import { translateRequest } from "./request-translator.js";
import { injectCacheControl } from "./cache.js";
import { resolveFileImages } from "../../utils/resolve-file-images.js";
import { translateResponse } from "./response-translator.js";
import { translateStream } from "./stream-translator.js";

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: AdapterTimeout;
}

const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

function mapError(
  status: number,
  body: unknown,
  provider: string,
  headers: Headers,
): SDKError | undefined {
  const errorBody = rec(body);
  const errorObj = rec(errorBody?.["error"]);
  const message = str(errorObj?.["message"], typeof body === "string" ? body : "Unknown error");
  const errorType = typeof errorObj?.["type"] === "string" ? errorObj["type"] : undefined;

  switch (status) {
    case 401:
      return new AuthenticationError(message, provider, errorType, body);
    case 403:
      return new AccessDeniedError(message, provider, errorType, body);
    case 404:
      return new NotFoundError(message, provider, errorType, body);
    case 400: {
      const classification = classifyByMessage(message);
      if (classification === "context_length") {
        return new ContextLengthError(message, provider, errorType, body);
      }
      if (classification === "content_filter") {
        return new ContentFilterError(message, provider, errorType, body);
      }
      return new InvalidRequestError(message, provider, errorType, body);
    }
    case 429: {
      const retryAfter = parseRetryAfterHeader(headers);
      return new RateLimitError(message, provider, errorType, retryAfter, body);
    }
    case 408:
      return new RequestTimeoutError(message);
    case 413:
      return new ContextLengthError(message, provider, errorType, body);
    case 422:
      return new InvalidRequestError(message, provider, errorType, body);
    case 529:
      return new ServerError(message, provider, errorType, status, body);
    default:
      if (status >= 500) {
        return new ServerError(message, provider, errorType, status, body);
      }
      break;
  }

  const classification = classifyByMessage(message);
  if (classification === "content_filter") {
    return new ContentFilterError(message, provider, errorType, body);
  }
  if (classification === "quota") {
    return new QuotaExceededError(message, provider, errorType, body);
  }
  if (classification === "not_found") {
    return new NotFoundError(message, provider, errorType, body);
  }
  if (classification === "auth") {
    return new AuthenticationError(message, provider, errorType, body);
  }
  return undefined;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: AdapterTimeout | undefined;

  constructor(options: AnthropicAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeout = options.timeout;
  }

  async complete(request: Request): Promise<Response> {
    const resolved = await resolveFileImages(request);
    const { body, headers: extraHeaders, warnings } = translateRequest(resolved);

    const useCache = shouldUseCache(request);
    const finalBody = useCache ? injectCacheControl(body) : body;

    const headers = this.buildHeaders(extraHeaders, useCache);

    const timeout = request.timeout ?? this.timeout;

    const response = await httpRequest({
      url: `${this.baseUrl}/v1/messages`,
      method: "POST",
      headers,
      body: finalBody,
      timeout,
      signal: request.abortSignal,
      mapError,
      provider: this.name,
    });

    const responseBody = rec(response.body) ?? {};
    const result = translateResponse(responseBody, response.rateLimit);
    if (warnings.length > 0) {
      result.warnings = [...result.warnings, ...warnings];
    }
    return result;
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    const resolved = await resolveFileImages(request);
    const { body, headers: extraHeaders } = translateRequest(resolved);

    const useCache = shouldUseCache(request);
    const finalBody = useCache
      ? injectCacheControl({ ...body, stream: true })
      : { ...body, stream: true };

    const headers = this.buildHeaders(extraHeaders, useCache);
    const timeout = request.timeout ?? this.timeout;

    const response = await httpRequestStream({
      url: `${this.baseUrl}/v1/messages`,
      method: "POST",
      headers,
      body: finalBody,
      timeout,
      signal: request.abortSignal,
      mapError,
      provider: this.name,
    });

    const sseEvents = parseSSE(response.body);
    yield* translateStream(sseEvents);
  }

  supportsToolChoice(mode: string): boolean {
    return mode === "auto" || mode === "none" || mode === "required" || mode === "named";
  }

  async initialize(): Promise<void> {
    // No initialization needed for HTTP-based adapter
  }

  async close(): Promise<void> {
    // No cleanup needed for HTTP-based adapter
  }

  private buildHeaders(
    extraHeaders: Record<string, string>,
    useCache: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      ...this.defaultHeaders,
      ...extraHeaders,
    };

    if (useCache) {
      const cacheHeader = "prompt-caching-2024-07-31";
      const existing = headers["anthropic-beta"];
      if (existing) {
        headers["anthropic-beta"] = `${existing},${cacheHeader}`;
      } else {
        headers["anthropic-beta"] = cacheHeader;
      }
    }

    return headers;
  }
}

function shouldUseCache(request: Request): boolean {
  const anthropicOptions = request.providerOptions?.["anthropic"];
  // Accept both snake_case (spec) and camelCase (legacy)
  if (anthropicOptions?.["auto_cache"] === false || anthropicOptions?.["autoCache"] === false) {
    return false;
  }
  return true;
}
