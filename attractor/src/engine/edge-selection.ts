import type { Edge, Graph, Node } from "../types/graph.js";
import type { Outcome } from "../types/outcome.js";
import type { Context } from "../types/context.js";
import { outgoingEdges, getStringAttr } from "../types/graph.js";
import { normalizeLabel } from "../utils/label.js";
import { evaluateCondition } from "../conditions/index.js";

/**
 * Sort edges by weight descending, then target node ID ascending (lexical).
 * Returns the best edge, or undefined if the list is empty.
 */
export function bestByWeightThenLexical(edges: readonly Edge[]): Edge | undefined {
  if (edges.length === 0) return undefined;
  const sorted = [...edges].sort((a, b) => {
    const wa = getIntWeight(a);
    const wb = getIntWeight(b);
    if (wb !== wa) return wb - wa; // descending weight
    return a.to.localeCompare(b.to); // ascending lexical
  });
  return sorted[0];
}

function getIntWeight(edge: Edge): number {
  const attr = edge.attributes.get("weight");
  if (!attr) return 0;
  if (attr.kind === "integer") return attr.value;
  if (attr.kind === "float") return Math.floor(attr.value);
  if (attr.kind === "string") {
    const n = parseInt(attr.value, 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Select the next edge from a node's outgoing edges, following the 5-step
 * priority algorithm from spec 3.3.
 */
export function selectEdge(
  node: Node,
  outcome: Outcome,
  context: Context,
  graph: Graph,
): Edge | undefined {
  const edges = outgoingEdges(graph, node.id);
  if (edges.length === 0) return undefined;

  // Step 1: Condition-matching edges
  const conditionMatched: Edge[] = [];
  for (const edge of edges) {
    const condition = getStringAttr(edge.attributes, "condition");
    if (condition !== "") {
      if (evaluateCondition(condition, outcome, context)) {
        conditionMatched.push(edge);
      }
    }
  }
  if (conditionMatched.length > 0) {
    return bestByWeightThenLexical(conditionMatched);
  }

  // Build eligible edges: unconditional + condition-passing
  const eligible = edges.filter((e) => {
    const condition = getStringAttr(e.attributes, "condition");
    if (condition === "") return true;
    return evaluateCondition(condition, outcome, context);
  });

  // Step 2: Preferred label match (search ALL edges per spec 3.3)
  if (outcome.preferredLabel !== "") {
    const normalizedPreferred = normalizeLabel(outcome.preferredLabel);
    for (const edge of edges) {
      const edgeLabel = getStringAttr(edge.attributes, "label");
      if (edgeLabel !== "" && normalizeLabel(edgeLabel) === normalizedPreferred) {
        return edge;
      }
    }
  }

  // Step 3: Suggested next IDs (search eligible edges only per spec 3.3)
  if (outcome.suggestedNextIds.length > 0) {
    for (const suggestedId of outcome.suggestedNextIds) {
      for (const edge of eligible) {
        if (edge.to === suggestedId) {
          return edge;
        }
      }
    }
  }

  // Step 4 & 5: Highest weight among unconditional edges, with lexical tiebreak
  const unconditional = edges.filter(
    (e) => getStringAttr(e.attributes, "condition") === "",
  );
  if (unconditional.length > 0) {
    return bestByWeightThenLexical(unconditional);
  }

  // Fallback: any edge
  return bestByWeightThenLexical(edges);
}
