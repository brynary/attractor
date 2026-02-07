import { describe, expect, test } from "bun:test";
import { checkGoalGates, getRetryTarget } from "../../src/engine/goal-gates.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Graph, Node, Outcome } from "../../src/types/index.js";
import type { AttributeValue } from "../../src/types/graph.js";
import { stringAttr, booleanAttr } from "../../src/types/graph.js";

function makeNode(
  id: string,
  attrs: Record<string, AttributeValue> = {},
): Node {
  return { id, attributes: new Map(Object.entries(attrs)) };
}

function makeGraph(
  nodes: Node[],
  graphAttrs: Record<string, AttributeValue> = {},
): Graph {
  const nodeMap = new Map<string, Node>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return {
    name: "test",
    attributes: new Map(Object.entries(graphAttrs)),
    nodes: nodeMap,
    edges: [],
  };
}

describe("checkGoalGates", () => {
  test("all gates satisfied returns satisfied=true", () => {
    const gate = makeNode("validate", { goal_gate: booleanAttr(true) });
    const graph = makeGraph([gate]);

    const outcomes = new Map<string, Outcome>([
      ["validate", createOutcome({ status: StageStatus.SUCCESS })],
    ]);

    const result = checkGoalGates(graph, outcomes);
    expect(result.satisfied).toBe(true);
    expect(result.failedGate).toBeUndefined();
  });

  test("partial success also satisfies gate", () => {
    const gate = makeNode("validate", { goal_gate: booleanAttr(true) });
    const graph = makeGraph([gate]);

    const outcomes = new Map<string, Outcome>([
      ["validate", createOutcome({ status: StageStatus.PARTIAL_SUCCESS })],
    ]);

    const result = checkGoalGates(graph, outcomes);
    expect(result.satisfied).toBe(true);
  });

  test("failed gate returns satisfied=false with failed node", () => {
    const gate = makeNode("validate", { goal_gate: booleanAttr(true) });
    const graph = makeGraph([gate]);

    const outcomes = new Map<string, Outcome>([
      ["validate", createOutcome({ status: StageStatus.FAIL })],
    ]);

    const result = checkGoalGates(graph, outcomes);
    expect(result.satisfied).toBe(false);
    expect(result.failedGate?.id).toBe("validate");
  });

  test("non-goal-gate nodes are ignored", () => {
    const regular = makeNode("build");
    const graph = makeGraph([regular]);

    const outcomes = new Map<string, Outcome>([
      ["build", createOutcome({ status: StageStatus.FAIL })],
    ]);

    const result = checkGoalGates(graph, outcomes);
    expect(result.satisfied).toBe(true);
  });

  test("empty outcomes returns satisfied", () => {
    const graph = makeGraph([]);
    const result = checkGoalGates(graph, new Map());
    expect(result.satisfied).toBe(true);
  });
});

describe("getRetryTarget", () => {
  test("returns node retry_target first", () => {
    const node = makeNode("n", { retry_target: stringAttr("plan") });
    const graph = makeGraph([node], { retry_target: stringAttr("graph_plan") });

    expect(getRetryTarget(node, graph)).toBe("plan");
  });

  test("falls back to node fallback_retry_target", () => {
    const node = makeNode("n", { fallback_retry_target: stringAttr("fallback") });
    const graph = makeGraph([node]);

    expect(getRetryTarget(node, graph)).toBe("fallback");
  });

  test("falls back to graph retry_target", () => {
    const node = makeNode("n");
    const graph = makeGraph([node], { retry_target: stringAttr("graph_plan") });

    expect(getRetryTarget(node, graph)).toBe("graph_plan");
  });

  test("falls back to graph fallback_retry_target", () => {
    const node = makeNode("n");
    const graph = makeGraph([node], {
      fallback_retry_target: stringAttr("graph_fallback"),
    });

    expect(getRetryTarget(node, graph)).toBe("graph_fallback");
  });

  test("returns undefined when no targets set", () => {
    const node = makeNode("n");
    const graph = makeGraph([node]);

    expect(getRetryTarget(node, graph)).toBeUndefined();
  });
});
