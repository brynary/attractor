import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import type { Handler } from "../types/handler.js";
import type { RetryPolicy } from "../types/retry.js";
import { StageStatus, createOutcome } from "../types/outcome.js";
import { getIntegerAttr, getBooleanAttr } from "../types/graph.js";
import { delayForAttempt, PRESET_POLICIES } from "../types/retry.js";

/**
 * Build a retry policy for a node based on its max_retries attribute,
 * the graph default_max_retry, and the standard backoff config.
 */
export function buildRetryPolicy(node: Node, graph: Graph): RetryPolicy {
  const nodeMaxRetries = node.attributes.has("max_retries")
    ? getIntegerAttr(node.attributes, "max_retries", 0)
    : undefined;
  const graphDefault = getIntegerAttr(graph.attributes, "default_max_retry", 0);
  const maxRetries = nodeMaxRetries !== undefined ? nodeMaxRetries : graphDefault;
  const maxAttempts = maxRetries + 1;

  const base = PRESET_POLICIES["standard"];
  if (!base) {
    throw new Error("standard retry policy not found");
  }

  return {
    maxAttempts,
    backoff: base.backoff,
    shouldRetry: base.shouldRetry,
  };
}

/**
 * Execute a handler with retry logic per spec 3.5.
 */
export async function executeWithRetry(
  node: Node,
  context: Context,
  graph: Graph,
  logsRoot: string,
  handler: Handler,
  retryPolicy: RetryPolicy,
): Promise<Outcome> {
  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    let outcome: Outcome;

    try {
      outcome = await handler.execute(node, context, graph, logsRoot);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (
        retryPolicy.shouldRetry(err) &&
        attempt < retryPolicy.maxAttempts
      ) {
        const delay = delayForAttempt(attempt, retryPolicy.backoff);
        await sleep(delay);
        continue;
      }
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: err.message,
      });
    }

    // SUCCESS or PARTIAL_SUCCESS -> return immediately
    if (
      outcome.status === StageStatus.SUCCESS ||
      outcome.status === StageStatus.PARTIAL_SUCCESS
    ) {
      return outcome;
    }

    // RETRY -> backoff and retry if within limits
    if (outcome.status === StageStatus.RETRY) {
      if (attempt < retryPolicy.maxAttempts) {
        context.set(
          `internal.retry_count.${node.id}`,
          String(attempt),
        );
        const delay = delayForAttempt(attempt, retryPolicy.backoff);
        await sleep(delay);
        continue;
      }
      // Retries exhausted
      const allowPartial = getBooleanAttr(node.attributes, "allow_partial", false);
      if (allowPartial) {
        return createOutcome({
          status: StageStatus.PARTIAL_SUCCESS,
          notes: "retries exhausted, partial accepted",
        });
      }
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "max retries exceeded",
      });
    }

    // FAIL -> return immediately
    if (outcome.status === StageStatus.FAIL) {
      return outcome;
    }

    // Any other status (SKIPPED etc) -> return as-is
    return outcome;
  }

  return createOutcome({
    status: StageStatus.FAIL,
    failureReason: "max retries exceeded",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
