import type { Node, Graph } from "../types/graph.js";
import type { Outcome } from "../types/outcome.js";
import { getBooleanAttr, getStringAttr } from "../types/graph.js";
import { StageStatus } from "../types/outcome.js";

export interface GoalGateResult {
  satisfied: boolean;
  failedGate: Node | undefined;
}

/**
 * Check all goal gates among visited nodes. Returns whether all are satisfied.
 * A goal gate is satisfied if its outcome status is SUCCESS or PARTIAL_SUCCESS.
 */
export function checkGoalGates(
  graph: Graph,
  nodeOutcomes: ReadonlyMap<string, Outcome>,
): GoalGateResult {
  for (const [nodeId, outcome] of nodeOutcomes) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    if (getBooleanAttr(node.attributes, "goal_gate", false)) {
      if (
        outcome.status !== StageStatus.SUCCESS &&
        outcome.status !== StageStatus.PARTIAL_SUCCESS
      ) {
        return { satisfied: false, failedGate: node };
      }
    }
  }
  return { satisfied: true, failedGate: undefined };
}

/**
 * Resolve the retry target for a failed goal gate node.
 * Priority: node retry_target -> node fallback_retry_target ->
 *           graph retry_target -> graph fallback_retry_target.
 */
export function getRetryTarget(node: Node, graph: Graph): string | undefined {
  const nodeRetry = getStringAttr(node.attributes, "retry_target");
  if (nodeRetry !== "") return nodeRetry;

  const nodeFallback = getStringAttr(node.attributes, "fallback_retry_target");
  if (nodeFallback !== "") return nodeFallback;

  const graphRetry = getStringAttr(graph.attributes, "retry_target");
  if (graphRetry !== "") return graphRetry;

  const graphFallback = getStringAttr(graph.attributes, "fallback_retry_target");
  if (graphFallback !== "") return graphFallback;

  return undefined;
}
