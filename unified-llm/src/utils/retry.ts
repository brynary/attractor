import { SDKError, ProviderError } from "../types/errors.js";

export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 2,
  baseDelay: 1.0,
  maxDelay: 60.0,
  backoffMultiplier: 2.0,
  jitter: true,
};

export function computeDelay(attempt: number, policy: RetryPolicy, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    if (retryAfter > policy.maxDelay) {
      return -1;
    }
    return retryAfter;
  }

  let delay = policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt);
  delay = Math.min(delay, policy.maxDelay);

  if (policy.jitter) {
    delay = delay * (0.5 + Math.random() * 1.0);
  }

  return delay;
}

export async function retry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      lastError = error;

      if (attempt >= policy.maxRetries) {
        throw error;
      }

      if (error instanceof SDKError && !error.retryable) {
        throw error;
      }

      const retryAfter =
        error instanceof ProviderError ? error.retryAfter : undefined;

      const delay = computeDelay(attempt, policy, retryAfter);

      if (delay < 0) {
        if (error instanceof ProviderError && retryAfter !== undefined) {
          throw new ProviderError(
            `${error.message} (Retry-After: ${retryAfter}s exceeds max delay of ${policy.maxDelay}s)`,
            error.provider,
            {
              statusCode: error.statusCode,
              errorCode: error.errorCode,
              retryable: error.retryable,
              retryAfter,
              raw: error.raw,
              cause: error,
            },
          );
        }
        throw error;
      }

      if (policy.onRetry) {
        policy.onRetry(error, attempt + 1, delay);
      }

      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  }

  throw lastError;
}
