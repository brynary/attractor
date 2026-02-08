/**
 * gRPC status code to SDK error mapping for Gemini API.
 *
 * Gemini API returns gRPC status codes in error responses.
 * This module maps those codes to appropriate SDK error types.
 */

import type { SDKError } from "../types/errors.js";
import {
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  RequestTimeoutError,
} from "../types/errors.js";
import { parseRetryAfterHeader } from "./http.js";

/**
 * Maps a gRPC status code to the appropriate SDK error type.
 *
 * @param grpcStatus - The gRPC status code from the error response
 * @param message - The error message
 * @param provider - The provider name
 * @param httpStatus - The HTTP status code
 * @param body - The raw error response body
 * @param headers - The HTTP response headers
 * @returns An SDK error instance, or undefined if the status code is not recognized
 */
export function mapGrpcStatusToError(
  grpcStatus: string,
  message: string,
  provider: string,
  httpStatus: number,
  body: unknown,
  headers: Headers,
): SDKError | undefined {
  switch (grpcStatus) {
    case "NOT_FOUND":
      return new NotFoundError(message, provider, grpcStatus, body);

    case "INVALID_ARGUMENT":
      return new InvalidRequestError(message, provider, grpcStatus, body);

    case "UNAUTHENTICATED":
      return new AuthenticationError(message, provider, grpcStatus, body);

    case "PERMISSION_DENIED":
      return new AccessDeniedError(message, provider, grpcStatus, body);

    case "RESOURCE_EXHAUSTED": {
      const retryAfter = parseRetryAfterHeader(headers);
      return new RateLimitError(message, provider, grpcStatus, retryAfter, body);
    }

    case "UNAVAILABLE":
    case "INTERNAL":
      return new ServerError(message, provider, grpcStatus, httpStatus, body);

    case "DEADLINE_EXCEEDED":
      return new RequestTimeoutError(message);

    case "ABORTED":
      return new ServerError(message, provider, grpcStatus, httpStatus, body);

    case "OUT_OF_RANGE":
      return new InvalidRequestError(message, provider, grpcStatus, body);

    case "UNIMPLEMENTED":
      return new InvalidRequestError(message, provider, grpcStatus, body);

    case "DATA_LOSS":
      return new ServerError(message, provider, grpcStatus, httpStatus, body);

    case "ALREADY_EXISTS":
      return new InvalidRequestError(message, provider, grpcStatus, body);

    case "FAILED_PRECONDITION":
      return new InvalidRequestError(message, provider, grpcStatus, body);

    case "CANCELLED":
      // Request was cancelled, typically by the client
      return new RequestTimeoutError(message);

    default:
      return undefined;
  }
}
