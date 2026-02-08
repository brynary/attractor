import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import type { Handler } from "../types/handler.js";
import type { RetryPolicy } from "../types/retry.js";
import { StageStatus, createOutcome } from "../types/outcome.js";
import { getIntegerAttr, getBooleanAttr, getStringAttr } from "../types/graph.js";
import { delayForAttempt, PRESET_POLICIES } from "../types/retry.js";

/**
 * Build a retry policy for a node based on its retry_policy preset name,
 * max_retries attribute, the graph default_max_retry, and backoff config.
 */
export function buildRetryPolicy(node: Node, graph: Graph): RetryPolicy {
  // Resolve max retries: node max_retries -> graph default_max_retry -> node retry_policy preset -> 1
  const nodeHasMaxRetries = node.attributes.has("max_retries");
  const graphHasDefault = graph.attributes.has("default_max_retry");
  const nodeHasRetryPolicy = node.attributes.has("retry_policy");

  // Resolve preset for backoff/shouldRetry config
  const presetName = getStringAttr(node.attributes, "retry_policy", "standard");
  const base = PRESET_POLICIES[presetName] ?? PRESET_POLICIES["standard"];
  if (!base) {
    throw new Error("standard retry policy not found");
  }

  let maxAttempts: number;
  if (nodeHasMaxRetries) {
    maxAttempts = getIntegerAttr(node.attributes, "max_retries", 0) + 1;
  } else if (graphHasDefault) {
    maxAttempts = getIntegerAttr(graph.attributes, "default_max_retry", 50) + 1;
  } else if (nodeHasRetryPolicy) {
    maxAttempts = base.maxAttempts;
  } else {
    // Spec 3.5: default is 0 retries (1 attempt)
    maxAttempts = 1;
  }

  return {
    maxAttempts,
    backoff: base.backoff,
    shouldRetry: base.shouldRetry,
  };
}

export interface RetryResult {
  outcome: Outcome;
  attempts: number;
}

export interface RetryCallbacks {
  onRetry?: (nodeId: string, attempt: number, maxAttempts: number, reason: string) => void;
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
  callbacks?: RetryCallbacks,
): Promise<RetryResult> {
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
        callbacks?.onRetry?.(node.id, attempt, retryPolicy.maxAttempts, err.message);
        const delay = delayForAttempt(attempt, retryPolicy.backoff);
        await sleep(delay);
        continue;
      }
      return {
        outcome: createOutcome({
          status: StageStatus.FAIL,
          failureReason: err.message,
        }),
        attempts: attempt,
      };
    }

    // SUCCESS or PARTIAL_SUCCESS -> reset retry counter and return
    if (
      outcome.status === StageStatus.SUCCESS ||
      outcome.status === StageStatus.PARTIAL_SUCCESS
    ) {
      context.set(`internal.retry_count.${node.id}`, "");
      return { outcome, attempts: attempt };
    }

    // RETRY -> backoff and retry if within limits
    if (outcome.status === StageStatus.RETRY) {
      if (attempt < retryPolicy.maxAttempts) {
        callbacks?.onRetry?.(node.id, attempt, retryPolicy.maxAttempts, outcome.failureReason);
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
        return {
          outcome: createOutcome({
            status: StageStatus.PARTIAL_SUCCESS,
            notes: "retries exhausted, partial accepted",
          }),
          attempts: attempt,
        };
      }
      return {
        outcome: createOutcome({
          status: StageStatus.FAIL,
          failureReason: "max retries exceeded",
        }),
        attempts: attempt,
      };
    }

    // FAIL -> return immediately
    if (outcome.status === StageStatus.FAIL) {
      return { outcome, attempts: attempt };
    }

    // Any other status (SKIPPED etc) -> return as-is
    return { outcome, attempts: attempt };
  }

  return {
    outcome: createOutcome({
      status: StageStatus.FAIL,
      failureReason: "max retries exceeded",
    }),
    attempts: retryPolicy.maxAttempts,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
