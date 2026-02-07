import { describe, test, expect } from "bun:test";
import { retry } from "../../src/utils/retry.js";
import type { RetryPolicy } from "../../src/utils/retry.js";
import { SDKError, ServerError, InvalidRequestError } from "../../src/types/errors.js";

describe("retry", () => {
  const fastPolicy: RetryPolicy = {
    maxRetries: 3,
    baseDelay: 0.001,
    maxDelay: 0.01,
    backoffMultiplier: 2.0,
    jitter: false,
  };

  test("returns result on first success", async () => {
    const result = await retry(() => Promise.resolve("ok"), fastPolicy);
    expect(result).toBe("ok");
  });

  test("retries on retryable errors and succeeds", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new ServerError("server error", "test");
      }
      return "recovered";
    }, fastPolicy);
    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  test("throws after max retries exhausted", async () => {
    let attempts = 0;
    await expect(
      retry(async () => {
        attempts++;
        throw new ServerError("server error", "test");
      }, fastPolicy),
    ).rejects.toThrow("server error");
    expect(attempts).toBe(4); // initial + 3 retries
  });

  test("does not retry non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      retry(async () => {
        attempts++;
        throw new InvalidRequestError("bad request", "test");
      }, fastPolicy),
    ).rejects.toThrow("bad request");
    expect(attempts).toBe(1);
  });

  test("calls onRetry callback", async () => {
    const retryAttempts: number[] = [];
    let attempts = 0;
    const policyWithCallback: RetryPolicy = {
      ...fastPolicy,
      maxRetries: 2,
      onRetry: (_error, attempt, _delay) => {
        retryAttempts.push(attempt);
      },
    };

    await retry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new SDKError("retryable", true);
      }
      return "done";
    }, policyWithCallback);

    expect(retryAttempts).toEqual([1, 2]);
  });

  test("does not retry non-Error throws", async () => {
    await expect(
      retry(async () => {
        throw "string error";
      }, fastPolicy),
    ).rejects.toBe("string error");
  });
});
