import { describe, test, expect } from "bun:test";
import {
  SDKError,
  ProviderError,
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContentFilterError,
  ContextLengthError,
  QuotaExceededError,
  RequestTimeoutError,
  AbortError,
  NetworkError,
  StreamError,
  InvalidToolCallError,
  NoObjectGeneratedError,
  ConfigurationError,
} from "../../src/types/errors.js";

describe("error hierarchy", () => {
  test("SDKError is an instance of Error", () => {
    const err = new SDKError("test", false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SDKError);
    expect(err.message).toBe("test");
    expect(err.retryable).toBe(false);
  });

  test("ProviderError extends SDKError", () => {
    const err = new ProviderError("test", "anthropic", {
      retryable: true,
      statusCode: 500,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SDKError);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe("anthropic");
    expect(err.statusCode).toBe(500);
  });

  test("AuthenticationError is not retryable", () => {
    const err = new AuthenticationError("bad key", "openai");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(401);
  });

  test("AccessDeniedError is not retryable", () => {
    const err = new AccessDeniedError("forbidden", "openai");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(403);
  });

  test("NotFoundError is not retryable", () => {
    const err = new NotFoundError("not found", "anthropic");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(404);
  });

  test("InvalidRequestError is not retryable", () => {
    const err = new InvalidRequestError("bad request", "openai");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(400);
  });

  test("RateLimitError is retryable with retryAfter", () => {
    const err = new RateLimitError("rate limited", "anthropic", 5);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(5);
  });

  test("ServerError is retryable", () => {
    const err = new ServerError("internal error", "openai", 503);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(503);
  });

  test("ContentFilterError is not retryable", () => {
    const err = new ContentFilterError("filtered", "openai");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  test("ContextLengthError is not retryable", () => {
    const err = new ContextLengthError("too long", "anthropic");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  test("QuotaExceededError is not retryable", () => {
    const err = new QuotaExceededError("quota exceeded", "openai");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  test("RequestTimeoutError is retryable", () => {
    const err = new RequestTimeoutError("timeout");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(true);
  });

  test("AbortError is not retryable", () => {
    const err = new AbortError("aborted");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(false);
  });

  test("NetworkError is retryable", () => {
    const err = new NetworkError("network failure");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(true);
  });

  test("StreamError is retryable", () => {
    const err = new StreamError("stream broken");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(true);
  });

  test("InvalidToolCallError is not retryable", () => {
    const err = new InvalidToolCallError("bad tool call");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(false);
  });

  test("NoObjectGeneratedError is not retryable", () => {
    const err = new NoObjectGeneratedError("no object");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(false);
  });

  test("ConfigurationError is not retryable", () => {
    const err = new ConfigurationError("bad config");
    expect(err).toBeInstanceOf(SDKError);
    expect(err.retryable).toBe(false);
  });
});
