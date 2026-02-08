import { describe, test, expect } from "bun:test";
import { mapGrpcStatusToError } from "../../src/utils/grpc-errors.js";
import {
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  RequestTimeoutError,
} from "../../src/types/errors.js";

describe("mapGrpcStatusToError", () => {
  const headers = new Headers();
  const provider = "gemini";
  const message = "Test error message";
  const httpStatus = 400;
  const body = { error: { message } };

  test("maps NOT_FOUND to NotFoundError", () => {
    const error = mapGrpcStatusToError("NOT_FOUND", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error?.message).toBe(message);
  });

  test("maps INVALID_ARGUMENT to InvalidRequestError", () => {
    const error = mapGrpcStatusToError("INVALID_ARGUMENT", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  test("maps UNAUTHENTICATED to AuthenticationError", () => {
    const error = mapGrpcStatusToError("UNAUTHENTICATED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  test("maps PERMISSION_DENIED to AccessDeniedError", () => {
    const error = mapGrpcStatusToError("PERMISSION_DENIED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(AccessDeniedError);
  });

  test("maps RESOURCE_EXHAUSTED to RateLimitError", () => {
    const error = mapGrpcStatusToError("RESOURCE_EXHAUSTED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(RateLimitError);
  });

  test("maps RESOURCE_EXHAUSTED with Retry-After header", () => {
    const headersWithRetry = new Headers({ "Retry-After": "60" });
    const error = mapGrpcStatusToError("RESOURCE_EXHAUSTED", message, provider, httpStatus, body, headersWithRetry);
    expect(error).toBeInstanceOf(RateLimitError);
    if (error instanceof RateLimitError) {
      expect(error.retryAfter).toBe(60);
    }
  });

  test("maps UNAVAILABLE to ServerError", () => {
    const error = mapGrpcStatusToError("UNAVAILABLE", message, provider, 503, body, headers);
    expect(error).toBeInstanceOf(ServerError);
  });

  test("maps INTERNAL to ServerError", () => {
    const error = mapGrpcStatusToError("INTERNAL", message, provider, 500, body, headers);
    expect(error).toBeInstanceOf(ServerError);
  });

  test("maps DEADLINE_EXCEEDED to RequestTimeoutError", () => {
    const error = mapGrpcStatusToError("DEADLINE_EXCEEDED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(RequestTimeoutError);
  });

  test("maps ABORTED to ServerError", () => {
    const error = mapGrpcStatusToError("ABORTED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(ServerError);
  });

  test("maps OUT_OF_RANGE to InvalidRequestError", () => {
    const error = mapGrpcStatusToError("OUT_OF_RANGE", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  test("maps UNIMPLEMENTED to InvalidRequestError", () => {
    const error = mapGrpcStatusToError("UNIMPLEMENTED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  test("maps DATA_LOSS to ServerError", () => {
    const error = mapGrpcStatusToError("DATA_LOSS", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(ServerError);
  });

  test("maps ALREADY_EXISTS to InvalidRequestError", () => {
    const error = mapGrpcStatusToError("ALREADY_EXISTS", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  test("maps FAILED_PRECONDITION to InvalidRequestError", () => {
    const error = mapGrpcStatusToError("FAILED_PRECONDITION", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  test("maps CANCELLED to RequestTimeoutError", () => {
    const error = mapGrpcStatusToError("CANCELLED", message, provider, httpStatus, body, headers);
    expect(error).toBeInstanceOf(RequestTimeoutError);
  });

  test("returns undefined for unknown status codes", () => {
    const error = mapGrpcStatusToError("UNKNOWN_STATUS", message, provider, httpStatus, body, headers);
    expect(error).toBeUndefined();
  });
});
