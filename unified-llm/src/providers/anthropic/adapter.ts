import type { Request } from "../../types/request.js";
import type { Response } from "../../types/response.js";
import type { StreamEvent } from "../../types/stream-event.js";
import type { ProviderAdapter } from "../../types/provider-adapter.js";
import type { AdapterTimeout } from "../../types/timeout.js";
import {
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContextLengthError,
  ProviderError,
} from "../../types/errors.js";
import { httpRequest, httpRequestStream } from "../../utils/http.js";
import { parseSSE } from "../../utils/sse.js";
import { str, rec } from "../../utils/extract.js";
import { translateRequest } from "./request-translator.js";
import { injectCacheControl } from "./cache.js";
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
): ProviderError | undefined {
  const errorBody = rec(body);
  const errorObj = rec(errorBody?.["error"]);
  const message = str(errorObj?.["message"], typeof body === "string" ? body : "Unknown error");
  const errorType = typeof errorObj?.["type"] === "string" ? errorObj["type"] : undefined;

  switch (status) {
    case 401:
      return new AuthenticationError(message, provider, body);
    case 403:
      return new AccessDeniedError(message, provider, body);
    case 404:
      return new NotFoundError(message, provider, body);
    case 400: {
      if (errorType === "invalid_request_error" && /context|token/.test(message)) {
        return new ContextLengthError(message, provider, body);
      }
      return new InvalidRequestError(message, provider, body);
    }
    case 429:
      return new RateLimitError(message, provider, undefined, body);
    case 529:
      return new ServerError(message, provider, status, body);
    default:
      if (status >= 500) {
        return new ServerError(message, provider, status, body);
      }
      return undefined;
  }
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
    const { body, headers: extraHeaders } = translateRequest(request);

    const useCache = shouldUseCache(request);
    const finalBody = useCache ? injectCacheControl(body) : body;

    const headers = this.buildHeaders(extraHeaders, useCache);

    const response = await httpRequest({
      url: `${this.baseUrl}/v1/messages`,
      method: "POST",
      headers,
      body: finalBody,
      timeout: this.timeout,
      mapError,
      provider: this.name,
    });

    const responseBody = rec(response.body) ?? {};
    return translateResponse(responseBody, response.rateLimit);
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    const { body, headers: extraHeaders } = translateRequest(request);

    const useCache = shouldUseCache(request);
    const finalBody = useCache
      ? injectCacheControl({ ...body, stream: true })
      : { ...body, stream: true };

    const headers = this.buildHeaders(extraHeaders, useCache);

    const response = await httpRequestStream({
      url: `${this.baseUrl}/v1/messages`,
      method: "POST",
      headers,
      body: finalBody,
      timeout: this.timeout,
      mapError,
      provider: this.name,
    });

    const sseEvents = parseSSE(response.body);
    yield* translateStream(sseEvents);
  }

  supportsToolChoice(mode: string): boolean {
    return mode === "auto" || mode === "none" || mode === "required" || mode === "named";
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

    if (useCache && !headers["anthropic-beta"]) {
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }

    return headers;
  }
}

function shouldUseCache(request: Request): boolean {
  const anthropicOptions = request.providerOptions?.["anthropic"];
  if (anthropicOptions?.["autoCache"] === false) {
    return false;
  }
  return true;
}
