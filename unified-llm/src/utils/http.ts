import type { AdapterTimeout } from "../types/timeout.js";
import type { RateLimitInfo } from "../types/response.js";
import {
  ProviderError,
  NetworkError,
  RequestTimeoutError,
  AbortError,
} from "../types/errors.js";

export interface HttpRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  timeout?: AdapterTimeout;
  signal?: AbortSignal;
  mapError?: (
    status: number,
    body: unknown,
    provider: string,
  ) => ProviderError | undefined;
  provider: string;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
  rateLimit?: RateLimitInfo;
}

function extractRateLimit(headers: Headers): RateLimitInfo | undefined {
  const requestsRemaining = headers.get("x-ratelimit-remaining-requests");
  const requestsLimit = headers.get("x-ratelimit-limit-requests");
  const tokensRemaining = headers.get("x-ratelimit-remaining-tokens");
  const tokensLimit = headers.get("x-ratelimit-limit-tokens");
  const resetAt = headers.get("x-ratelimit-reset");

  if (
    requestsRemaining === null &&
    requestsLimit === null &&
    tokensRemaining === null &&
    tokensLimit === null
  ) {
    return undefined;
  }

  return {
    requestsRemaining:
      requestsRemaining !== null ? parseInt(requestsRemaining, 10) : undefined,
    requestsLimit:
      requestsLimit !== null ? parseInt(requestsLimit, 10) : undefined,
    tokensRemaining:
      tokensRemaining !== null ? parseInt(tokensRemaining, 10) : undefined,
    tokensLimit: tokensLimit !== null ? parseInt(tokensLimit, 10) : undefined,
    resetAt: resetAt !== null ? new Date(resetAt) : undefined,
  };
}

export async function httpRequest(
  options: HttpRequestOptions,
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeoutMs = options.timeout?.request ?? 60_000;

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const fetchOptions: RequestInit = {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(options.url, fetchOptions);
    const rateLimit = extractRateLimit(response.headers);

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text().catch(() => "Unknown error");
      }

      if (options.mapError) {
        const mapped = options.mapError(
          response.status,
          errorBody,
          options.provider,
        );
        if (mapped) {
          throw mapped;
        }
      }

      throw new ProviderError(
        `HTTP ${response.status}: ${typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody)}`,
        options.provider,
        {
          statusCode: response.status,
          retryable: response.status >= 500 || response.status === 429,
          raw: errorBody,
        },
      );
    }

    const body = await response.json();
    return { status: response.status, headers: response.headers, body, rateLimit };
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        throw new AbortError("Request was aborted");
      }
      throw new RequestTimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    if (error instanceof TypeError) {
      throw new NetworkError(`Network error: ${error.message}`, {
        cause: error,
      });
    }
    throw new NetworkError(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function httpRequestStream(
  options: HttpRequestOptions,
): Promise<{ headers: Headers; body: ReadableStream<Uint8Array>; rateLimit?: RateLimitInfo }> {
  const controller = new AbortController();
  const timeoutMs = options.timeout?.request ?? 60_000;

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const fetchOptions: RequestInit = {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(options.url, fetchOptions);
    clearTimeout(timeoutId);

    const rateLimit = extractRateLimit(response.headers);

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text().catch(() => "Unknown error");
      }

      if (options.mapError) {
        const mapped = options.mapError(
          response.status,
          errorBody,
          options.provider,
        );
        if (mapped) {
          throw mapped;
        }
      }

      throw new ProviderError(
        `HTTP ${response.status}: ${typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody)}`,
        options.provider,
        {
          statusCode: response.status,
          retryable: response.status >= 500 || response.status === 429,
          raw: errorBody,
        },
      );
    }

    if (!response.body) {
      throw new NetworkError("Response body is null");
    }

    return { headers: response.headers, body: response.body, rateLimit };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ProviderError || error instanceof NetworkError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        throw new AbortError("Request was aborted");
      }
      throw new RequestTimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    if (error instanceof TypeError) {
      throw new NetworkError(`Network error: ${error.message}`, {
        cause: error,
      });
    }
    throw new NetworkError(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
