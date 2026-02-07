export class SDKError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "SDKError";
    this.retryable = retryable;
  }
}

export class ProviderError extends SDKError {
  readonly provider: string;
  readonly statusCode?: number;
  readonly errorCode?: string;
  readonly retryAfter?: number;
  readonly raw?: unknown;

  constructor(
    message: string,
    provider: string,
    options: {
      statusCode?: number;
      errorCode?: string;
      retryable: boolean;
      retryAfter?: number;
      raw?: unknown;
      cause?: Error;
    },
  ) {
    super(message, options.retryable, { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.retryAfter = options.retryAfter;
    this.raw = options.raw;
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, statusCode: 401, raw });
    this.name = "AuthenticationError";
  }
}

export class AccessDeniedError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, statusCode: 403, raw });
    this.name = "AccessDeniedError";
  }
}

export class NotFoundError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, statusCode: 404, raw });
    this.name = "NotFoundError";
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, statusCode: 400, raw });
    this.name = "InvalidRequestError";
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    provider: string,
    retryAfter?: number,
    raw?: unknown,
  ) {
    super(message, provider, {
      retryable: true,
      statusCode: 429,
      retryAfter,
      raw,
    });
    this.name = "RateLimitError";
  }
}

export class ServerError extends ProviderError {
  constructor(
    message: string,
    provider: string,
    statusCode?: number,
    raw?: unknown,
  ) {
    super(message, provider, {
      retryable: true,
      statusCode: statusCode ?? 500,
      raw,
    });
    this.name = "ServerError";
  }
}

export class ContentFilterError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, raw });
    this.name = "ContentFilterError";
  }
}

export class ContextLengthError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, raw });
    this.name = "ContextLengthError";
  }
}

export class QuotaExceededError extends ProviderError {
  constructor(message: string, provider: string, raw?: unknown) {
    super(message, provider, { retryable: false, raw });
    this.name = "QuotaExceededError";
  }
}

export class RequestTimeoutError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, true, options);
    this.name = "RequestTimeoutError";
  }
}

export class AbortError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, false, options);
    this.name = "AbortError";
  }
}

export class NetworkError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, true, options);
    this.name = "NetworkError";
  }
}

export class StreamError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, true, options);
    this.name = "StreamError";
  }
}

export class InvalidToolCallError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, false, options);
    this.name = "InvalidToolCallError";
  }
}

export class NoObjectGeneratedError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, false, options);
    this.name = "NoObjectGeneratedError";
  }
}

export class ConfigurationError extends SDKError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, false, options);
    this.name = "ConfigurationError";
  }
}
