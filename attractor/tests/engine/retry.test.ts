import { describe, expect, test } from "bun:test";
import { executeWithRetry, buildRetryPolicy } from "../../src/engine/retry.js";
import { Context } from "../../src/types/context.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Handler } from "../../src/types/handler.js";
import type { Node, Graph, Outcome } from "../../src/types/index.js";
import type { RetryPolicy } from "../../src/types/retry.js";
import type { AttributeValue } from "../../src/types/graph.js";
import { integerAttr, booleanAttr } from "../../src/types/graph.js";

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

  test("defaults to 1 attempt when nothing set", () => {
    const node = makeNode("n");
    const graph = makeGraph();
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(1);
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

    expect(result.status).toBe(StageStatus.SUCCESS);
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

    expect(result.status).toBe(StageStatus.FAIL);
    expect(result.failureReason).toBe("broken");
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

    expect(result.status).toBe(StageStatus.SUCCESS);
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

    expect(result.status).toBe(StageStatus.FAIL);
    expect(result.failureReason).toBe("max retries exceeded");
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

    expect(result.status).toBe(StageStatus.PARTIAL_SUCCESS);
    expect(result.notes).toContain("partial accepted");
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

    expect(result.status).toBe(StageStatus.SUCCESS);
    expect(callCount).toBe(2);
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

    expect(result.status).toBe(StageStatus.FAIL);
    expect(result.failureReason).toContain("authentication error");
  });
});
