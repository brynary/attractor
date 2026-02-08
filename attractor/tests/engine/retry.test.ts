import { describe, expect, test } from "bun:test";
import { executeWithRetry, buildRetryPolicy } from "../../src/engine/retry.js";
import { Context } from "../../src/types/context.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Handler } from "../../src/types/handler.js";
import type { Node, Graph, Outcome } from "../../src/types/index.js";
import type { RetryPolicy } from "../../src/types/retry.js";
import type { AttributeValue } from "../../src/types/graph.js";
import { integerAttr, booleanAttr, stringAttr } from "../../src/types/graph.js";

function makeNode(
  id: string,
  attrs: Record<string, AttributeValue> = {},
): Node {
  return { id, attributes: new Map(Object.entries(attrs)) };
}

function makeGraph(
  attrs: Record<string, AttributeValue> = {},
): Graph {
  return {
    name: "test",
    attributes: new Map(Object.entries(attrs)),
    nodes: new Map(),
    edges: [],
  };
}

function makeHandler(fn: () => Promise<Outcome>): Handler {
  return {
    execute: fn,
  };
}

function noRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 1,
    backoff: { initialDelayMs: 0, backoffFactor: 1, maxDelayMs: 0, jitter: false },
    shouldRetry: () => false,
  };
}

function fastRetryPolicy(maxAttempts: number): RetryPolicy {
  return {
    maxAttempts,
    backoff: { initialDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false },
    shouldRetry: () => true,
  };
}

describe("buildRetryPolicy", () => {
  test("uses node max_retries when set", () => {
    const node = makeNode("n", { max_retries: integerAttr(3) });
    const graph = makeGraph({ default_max_retry: integerAttr(10) });
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(4); // 3 + 1
  });

  test("falls back to graph default_max_retry", () => {
    const node = makeNode("n");
    const graph = makeGraph({ default_max_retry: integerAttr(2) });
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(3); // 2 + 1
  });

  test("defaults to 1 attempt when nothing set (spec 3.5)", () => {
    const node = makeNode("n");
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    // Spec 3.5: default is 0 retries (1 attempt) when no retry config
    expect(policy.maxAttempts).toBe(1);
  });

  test("uses preset maxAttempts for named preset when no max_retries or graph default", () => {
    const node = makeNode("n", { retry_policy: stringAttr("patient") });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    // patient preset has maxAttempts=3
    expect(policy.maxAttempts).toBe(3);
  });

  test("graph default_max_retry overrides preset maxAttempts", () => {
    const node = makeNode("n", { retry_policy: stringAttr("patient") });
    const graph = makeGraph({ default_max_retry: integerAttr(10) });
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(11); // 10 + 1
  });

  test("uses named retry_policy preset from node attribute", () => {
    const node = makeNode("n", {
      retry_policy: stringAttr("patient"),
      max_retries: integerAttr(2),
    });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(3); // 2 + 1
    // patient preset has backoffFactor=3.0 and initialDelayMs=2000
    expect(policy.backoff.backoffFactor).toBe(3.0);
    expect(policy.backoff.initialDelayMs).toBe(2000);
  });

  test("uses aggressive preset backoff config", () => {
    const node = makeNode("n", {
      retry_policy: stringAttr("aggressive"),
      max_retries: integerAttr(1),
    });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.backoff.initialDelayMs).toBe(500);
    expect(policy.backoff.backoffFactor).toBe(2.0);
  });

  test("falls back to standard when unknown preset name", () => {
    const node = makeNode("n", {
      retry_policy: stringAttr("nonexistent"),
      max_retries: integerAttr(1),
    });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    // Falls back to standard: initialDelayMs=200, backoffFactor=2.0
    expect(policy.backoff.initialDelayMs).toBe(200);
    expect(policy.backoff.backoffFactor).toBe(2.0);
  });
});

describe("defaultShouldRetry via buildRetryPolicy", () => {
  test("returns false for validation errors", () => {
    const node = makeNode("n", { max_retries: integerAttr(3) });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.shouldRetry(new Error("validation error: missing field"))).toBe(false);
  });

  test("returns false for configuration errors", () => {
    const node = makeNode("n", { max_retries: integerAttr(3) });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.shouldRetry(new Error("configuration error: bad setting"))).toBe(false);
  });

  test("returns true for rate limit errors", () => {
    const node = makeNode("n", { max_retries: integerAttr(3) });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.shouldRetry(new Error("rate limit exceeded"))).toBe(true);
  });

  test("returns false for authentication errors", () => {
    const node = makeNode("n", { max_retries: integerAttr(3) });
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.shouldRetry(new Error("authentication failed 401"))).toBe(false);
  });
});

describe("executeWithRetry", () => {
  test("returns SUCCESS on first attempt", async () => {
    const handler = makeHandler(async () =>
      createOutcome({ status: StageStatus.SUCCESS }),
    );

    const result = await executeWithRetry(
      makeNode("n"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      noRetryPolicy(),
    );

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.attempts).toBe(1);
  });

  test("returns FAIL immediately without retry", async () => {
    const handler = makeHandler(async () =>
      createOutcome({ status: StageStatus.FAIL, failureReason: "broken" }),
    );

    const result = await executeWithRetry(
      makeNode("n"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(3),
    );

    expect(result.outcome.status).toBe(StageStatus.FAIL);
    expect(result.outcome.failureReason).toBe("broken");
    expect(result.attempts).toBe(1);
  });

  test("retries on RETRY status and eventually succeeds", async () => {
    let callCount = 0;
    const handler = makeHandler(async () => {
      callCount++;
      if (callCount < 3) {
        return createOutcome({ status: StageStatus.RETRY });
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    });

    const result = await executeWithRetry(
      makeNode("n"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(5),
    );

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);
  });

  test("returns FAIL when retries exhausted", async () => {
    const handler = makeHandler(async () =>
      createOutcome({ status: StageStatus.RETRY }),
    );

    const result = await executeWithRetry(
      makeNode("n"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(2),
    );

    expect(result.outcome.status).toBe(StageStatus.FAIL);
    expect(result.outcome.failureReason).toBe("max retries exceeded");
    expect(result.attempts).toBe(2);
  });

  test("returns PARTIAL_SUCCESS when allow_partial and retries exhausted", async () => {
    const handler = makeHandler(async () =>
      createOutcome({ status: StageStatus.RETRY }),
    );

    const node = makeNode("n", { allow_partial: booleanAttr(true) });

    const result = await executeWithRetry(
      node,
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(2),
    );

    expect(result.outcome.status).toBe(StageStatus.PARTIAL_SUCCESS);
    expect(result.outcome.notes).toContain("partial accepted");
  });

  test("retries on exception when shouldRetry returns true", async () => {
    let callCount = 0;
    const handler = makeHandler(async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error("rate limit");
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    });

    const result = await executeWithRetry(
      makeNode("n"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(3),
    );

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.attempts).toBe(2);
    expect(callCount).toBe(2);
  });

  test("calls onRetry callback when retrying on RETRY status", async () => {
    let callCount = 0;
    const handler = makeHandler(async () => {
      callCount++;
      if (callCount < 3) {
        return createOutcome({ status: StageStatus.RETRY, failureReason: "not ready" });
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    });

    const retryEvents: Array<{ nodeId: string; attempt: number; maxAttempts: number; reason: string }> = [];
    const result = await executeWithRetry(
      makeNode("myNode"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(5),
      {
        onRetry: (nodeId, attempt, maxAttempts, reason) => {
          retryEvents.push({ nodeId, attempt, maxAttempts, reason });
        },
      },
    );

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0]?.nodeId).toBe("myNode");
    expect(retryEvents[0]?.attempt).toBe(1);
    expect(retryEvents[1]?.attempt).toBe(2);
  });

  test("calls onRetry callback when retrying on exception", async () => {
    let callCount = 0;
    const handler = makeHandler(async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error("transient error");
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    });

    const retryEvents: Array<{ nodeId: string; attempt: number; reason: string }> = [];
    const result = await executeWithRetry(
      makeNode("errNode"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(3),
      {
        onRetry: (nodeId, attempt, _maxAttempts, reason) => {
          retryEvents.push({ nodeId, attempt, reason });
        },
      },
    );

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]?.nodeId).toBe("errNode");
    expect(retryEvents[0]?.reason).toBe("transient error");
  });

  test("resets retry counter on success after retries", async () => {
    let callCount = 0;
    const handler = makeHandler(async () => {
      callCount++;
      if (callCount < 3) {
        return createOutcome({ status: StageStatus.RETRY });
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    });

    const context = new Context();
    const result = await executeWithRetry(
      makeNode("myNode"),
      context,
      makeGraph(),
      "/tmp",
      handler,
      fastRetryPolicy(5),
    );

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // Retry counter should be reset (cleared to empty) on success
    expect(context.get("internal.retry_count.myNode")).toBe("");
  });

  test("returns FAIL on exception when shouldRetry returns false", async () => {
    const handler = makeHandler(async () => {
      throw new Error("authentication error");
    });

    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoff: { initialDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false },
      shouldRetry: () => false,
    };

    const result = await executeWithRetry(
      makeNode("n"),
      new Context(),
      makeGraph(),
      "/tmp",
      handler,
      policy,
    );

    expect(result.outcome.status).toBe(StageStatus.FAIL);
    expect(result.outcome.failureReason).toContain("authentication error");
  });
});
