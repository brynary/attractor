import { describe, expect, test } from "bun:test";
import { selectEdge, bestByWeightThenLexical } from "../../src/engine/edge-selection.js";
import { Context } from "../../src/types/context.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Graph, Node, Edge, AttributeValue } from "../../src/types/graph.js";
import { stringAttr, integerAttr } from "../../src/types/graph.js";

function makeNode(id: string, attrs: Record<string, AttributeValue> = {}): Node {
  return { id, attributes: new Map(Object.entries(attrs)) };
}

function makeEdge(
  from: string,
  to: string,
  attrs: Record<string, AttributeValue> = {},
): Edge {
  return { from, to, attributes: new Map(Object.entries(attrs)) };
}

function makeGraph(
  nodes: Node[],
  edges: Edge[],
): Graph {
  const nodeMap = new Map<string, Node>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return { name: "test", attributes: new Map(), nodes: nodeMap, edges };
}

describe("bestByWeightThenLexical", () => {
  test("returns undefined for empty list", () => {
    expect(bestByWeightThenLexical([])).toBeUndefined();
  });

  test("returns single edge", () => {
    const edge = makeEdge("A", "B");
    expect(bestByWeightThenLexical([edge])).toBe(edge);
  });

  test("picks highest weight", () => {
    const low = makeEdge("A", "B", { weight: integerAttr(1) });
    const high = makeEdge("A", "C", { weight: integerAttr(10) });
    expect(bestByWeightThenLexical([low, high])?.to).toBe("C");
  });

  test("breaks weight ties lexically", () => {
    const edgeZ = makeEdge("A", "Z", { weight: integerAttr(5) });
    const edgeA = makeEdge("A", "A_target", { weight: integerAttr(5) });
    expect(bestByWeightThenLexical([edgeZ, edgeA])?.to).toBe("A_target");
  });
});

describe("selectEdge", () => {
  test("step 1: condition match wins over unconditional", () => {
    const nodeA = makeNode("A");
    const unconditional = makeEdge("A", "B");
    const conditional = makeEdge("A", "C", {
      condition: stringAttr("outcome=success"),
    });
    const graph = makeGraph([nodeA, makeNode("B"), makeNode("C")], [unconditional, conditional]);

    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const context = new Context();

    const result = selectEdge(nodeA, outcome, context, graph);
    expect(result?.to).toBe("C");
  });

  test("step 1: non-matching condition falls through", () => {
    const nodeA = makeNode("A");
    const unconditional = makeEdge("A", "B");
    const conditional = makeEdge("A", "C", {
      condition: stringAttr("outcome=fail"),
    });
    const graph = makeGraph([nodeA, makeNode("B"), makeNode("C")], [unconditional, conditional]);

    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const context = new Context();

    const result = selectEdge(nodeA, outcome, context, graph);
    expect(result?.to).toBe("B");
  });

  test("step 1: multiple conditions pick best by weight", () => {
    const nodeA = makeNode("A");
    const cond1 = makeEdge("A", "B", {
      condition: stringAttr("outcome=success"),
      weight: integerAttr(1),
    });
    const cond2 = makeEdge("A", "C", {
      condition: stringAttr("outcome=success"),
      weight: integerAttr(10),
    });
    const graph = makeGraph(
      [nodeA, makeNode("B"), makeNode("C")],
      [cond1, cond2],
    );

    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result?.to).toBe("C");
  });

  test("step 2: preferred label match", () => {
    const nodeA = makeNode("A");
    const e1 = makeEdge("A", "B", { label: stringAttr("Yes") });
    const e2 = makeEdge("A", "C", { label: stringAttr("No") });
    const graph = makeGraph(
      [nodeA, makeNode("B"), makeNode("C")],
      [e1, e2],
    );

    const outcome = createOutcome({
      status: StageStatus.SUCCESS,
      preferredLabel: "yes",
    });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result?.to).toBe("B");
  });

  test("step 2: preferred label with accelerator prefix", () => {
    const nodeA = makeNode("A");
    const e1 = makeEdge("A", "B", { label: stringAttr("[Y] Yes") });
    const e2 = makeEdge("A", "C", { label: stringAttr("[N] No") });
    const graph = makeGraph(
      [nodeA, makeNode("B"), makeNode("C")],
      [e1, e2],
    );

    const outcome = createOutcome({
      status: StageStatus.SUCCESS,
      preferredLabel: "Yes",
    });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result?.to).toBe("B");
  });

  test("step 3: suggested next IDs", () => {
    const nodeA = makeNode("A");
    const e1 = makeEdge("A", "B");
    const e2 = makeEdge("A", "C");
    const graph = makeGraph(
      [nodeA, makeNode("B"), makeNode("C")],
      [e1, e2],
    );

    const outcome = createOutcome({
      status: StageStatus.SUCCESS,
      suggestedNextIds: ["C"],
    });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result?.to).toBe("C");
  });

  test("step 4: highest weight among unconditional", () => {
    const nodeA = makeNode("A");
    const e1 = makeEdge("A", "B", { weight: integerAttr(1) });
    const e2 = makeEdge("A", "C", { weight: integerAttr(5) });
    const graph = makeGraph(
      [nodeA, makeNode("B"), makeNode("C")],
      [e1, e2],
    );

    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result?.to).toBe("C");
  });

  test("step 5: lexical tiebreak when weights equal", () => {
    const nodeA = makeNode("A");
    const e1 = makeEdge("A", "Z_node");
    const e2 = makeEdge("A", "A_node");
    const graph = makeGraph(
      [nodeA, makeNode("Z_node"), makeNode("A_node")],
      [e1, e2],
    );

    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result?.to).toBe("A_node");
  });

  test("returns undefined when no edges", () => {
    const nodeA = makeNode("A");
    const graph = makeGraph([nodeA], []);

    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const result = selectEdge(nodeA, outcome, new Context(), graph);
    expect(result).toBeUndefined();
  });
});
