import { SDKError, ProviderError } from "../types/errors.js";

export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  onRetry?: (error: SDKError, attempt: number, delay: number) => void;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 2,
  baseDelay: 1.0,
  maxDelay: 60.0,
  backoffMultiplier: 2.0,
  jitter: true,
};

function computeDelay(attempt: number, policy: RetryPolicy, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    return retryAfter;
  }

  let delay = policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt);
  delay = Math.min(delay, policy.maxDelay);

  if (policy.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
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

      if (error instanceof SDKError && policy.onRetry) {
        policy.onRetry(error, attempt + 1, delay);
      }

      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  }

  throw lastError;
}
