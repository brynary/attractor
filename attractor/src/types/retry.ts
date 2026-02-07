export interface BackoffConfig {
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffConfig;
  shouldRetry: (error: Error) => boolean;
}

function defaultShouldRetry(error: Error): boolean {
  const msg = error.message.toLowerCase();
  if (msg.includes("rate limit") || msg.includes("429")) return true;
  if (msg.includes("server error") || msg.includes("5xx") || msg.includes("500") || msg.includes("502") || msg.includes("503")) return true;
  if (msg.includes("network") || msg.includes("timeout") || msg.includes("econnrefused")) return true;
  if (msg.includes("authentication") || msg.includes("401") || msg.includes("403")) return false;
  if (msg.includes("bad request") || msg.includes("400")) return false;
  return false;
}

export const PRESET_POLICIES: Record<string, RetryPolicy> = {
  none: {
    maxAttempts: 1,
    backoff: { initialDelayMs: 0, backoffFactor: 1, maxDelayMs: 0, jitter: false },
    shouldRetry: () => false,
  },
  standard: {
    maxAttempts: 5,
    backoff: { initialDelayMs: 200, backoffFactor: 2.0, maxDelayMs: 60000, jitter: true },
    shouldRetry: defaultShouldRetry,
  },
  aggressive: {
    maxAttempts: 5,
    backoff: { initialDelayMs: 500, backoffFactor: 2.0, maxDelayMs: 60000, jitter: true },
    shouldRetry: defaultShouldRetry,
  },
  linear: {
    maxAttempts: 3,
    backoff: { initialDelayMs: 500, backoffFactor: 1.0, maxDelayMs: 60000, jitter: true },
    shouldRetry: defaultShouldRetry,
  },
  patient: {
    maxAttempts: 3,
    backoff: { initialDelayMs: 2000, backoffFactor: 3.0, maxDelayMs: 60000, jitter: true },
    shouldRetry: defaultShouldRetry,
  },
};

export function delayForAttempt(attempt: number, config: BackoffConfig): number {
  let delay = config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1);
  delay = Math.min(delay, config.maxDelayMs);
  if (config.jitter) {
    delay = delay * (0.5 + Math.random());
  }
  return Math.floor(delay);
}
