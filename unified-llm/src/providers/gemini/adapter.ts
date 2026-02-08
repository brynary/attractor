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
  ProviderError,
} from "../../types/errors.js";
import { httpRequest, httpRequestStream } from "../../utils/http.js";
import { parseSSE } from "../../utils/sse.js";
import { str, rec } from "../../utils/extract.js";
import { translateRequest } from "./request-translator.js";
import { resolveFileImages } from "../../utils/resolve-file-images.js";
import { translateResponse } from "./response-translator.js";
import { translateStream } from "./stream-translator.js";

export interface GeminiAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: AdapterTimeout;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

function parseRetryAfterHeader(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds;
  }
  return undefined;
}

function mapError(
  status: number,
  body: unknown,
  provider: string,
  headers: Headers,
): ProviderError | undefined {
  const errorBody = rec(body);
  const errorObj = rec(errorBody?.["error"]);
  const message = str(
    errorObj?.["message"],
    typeof body === "string" ? body : "Unknown error",
  );

  switch (status) {
    case 401:
      return new AuthenticationError(message, provider, body);
    case 403:
      return new AccessDeniedError(message, provider, body);
    case 404:
      return new NotFoundError(message, provider, body);
    case 400:
      return new InvalidRequestError(message, provider, body);
    case 429: {
      const retryAfter = parseRetryAfterHeader(headers);
      return new RateLimitError(message, provider, retryAfter, body);
    }
    default:
      if (status >= 500) {
        return new ServerError(message, provider, status, body);
      }
      return undefined;
  }
}

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";
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
    const { body } = translateRequest(resolved);

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
    return translateResponse(responseBody, response.rateLimit);
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

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...this.defaultHeaders,
    };
  }
}
