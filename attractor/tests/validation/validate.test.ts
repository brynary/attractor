import { describe, test, expect } from "bun:test";
import { validate, validateOrRaise, ValidationError } from "../../src/validation/validate.js";
import type { Graph, Node, Edge, AttributeValue } from "../../src/types/graph.js";
import { stringAttr, booleanAttr } from "../../src/types/graph.js";
import { Severity } from "../../src/types/diagnostic.js";

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
  graphAttrs: Record<string, AttributeValue> = {},
): Graph {
  const nodeMap = new Map<string, Node>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }
  return {
    name: "test",
    attributes: new Map(Object.entries(graphAttrs)),
    nodes: nodeMap,
    edges,
  };
}

/** A valid minimal pipeline: start -> task -> exit */
function validGraph(): Graph {
  return makeGraph(
    [
      makeNode("start", { shape: stringAttr("Mdiamond") }),
      makeNode("task", { shape: stringAttr("box"), prompt: stringAttr("Do stuff") }),
      makeNode("done", { shape: stringAttr("Msquare") }),
    ],
    [makeEdge("start", "task"), makeEdge("task", "done")],
  );
}

describe("start_node rule", () => {
  test("missing start node produces error", () => {
    const graph = makeGraph(
      [makeNode("done", { shape: stringAttr("Msquare") })],
      [],
    );
    const diags = validate(graph);
    const startErrors = diags.filter((d) => d.rule === "start_node");
    expect(startErrors.length).toBe(1);
    expect(startErrors[0]?.severity).toBe(Severity.ERROR);
  });

  test("multiple start nodes produces error", () => {
    const graph = makeGraph(
      [
        makeNode("s1", { shape: stringAttr("Mdiamond") }),
        makeNode("s2", { shape: stringAttr("Mdiamond") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("s1", "done"), makeEdge("s2", "done")],
    );
    const diags = validate(graph);
    const startErrors = diags.filter((d) => d.rule === "start_node");
    expect(startErrors.length).toBe(1);
    expect(startErrors[0]?.message).toContain("found 2");
  });
});

describe("terminal_node rule", () => {
  test("missing terminal node produces error", () => {
    const graph = makeGraph(
      [makeNode("start", { shape: stringAttr("Mdiamond") })],
      [],
    );
    const diags = validate(graph);
    const termErrors = diags.filter((d) => d.rule === "terminal_node");
    expect(termErrors.length).toBe(1);
    expect(termErrors[0]?.severity).toBe(Severity.ERROR);
  });
});

describe("reachability rule", () => {
  test("orphan node produces error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("orphan", { shape: stringAttr("box"), prompt: stringAttr("x") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "done")],
    );
    const diags = validate(graph);
    const reachErrors = diags.filter((d) => d.rule === "reachability");
    expect(reachErrors.length).toBe(1);
    expect(reachErrors[0]?.nodeId).toBe("orphan");
  });
});

describe("edge_target_exists rule", () => {
  test("edge to nonexistent node produces error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "done"), makeEdge("start", "ghost")],
    );
    const diags = validate(graph);
    const edgeErrors = diags.filter((d) => d.rule === "edge_target_exists");
    expect(edgeErrors.length).toBe(1);
    expect(edgeErrors[0]?.message).toContain("ghost");
  });
});

describe("start_no_incoming rule", () => {
  test("start with incoming edge produces error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { shape: stringAttr("box"), prompt: stringAttr("x") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "task"),
        makeEdge("task", "done"),
        makeEdge("task", "start"),
      ],
    );
    const diags = validate(graph);
    const startInc = diags.filter((d) => d.rule === "start_no_incoming");
    expect(startInc.length).toBe(1);
  });
});

describe("exit_no_outgoing rule", () => {
  test("exit with outgoing edge produces error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { shape: stringAttr("box"), prompt: stringAttr("x") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "task"),
        makeEdge("task", "done"),
        makeEdge("done", "task"),
      ],
    );
    const diags = validate(graph);
    const exitOut = diags.filter((d) => d.rule === "exit_no_outgoing");
    expect(exitOut.length).toBe(1);
  });
});

describe("condition_syntax rule", () => {
  test("valid condition produces no error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "done", { condition: stringAttr("outcome=success && context.flag=true") })],
    );
    const diags = validate(graph);
    const condErrors = diags.filter((d) => d.rule === "condition_syntax");
    expect(condErrors.length).toBe(0);
  });

  test("malformed condition produces error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "done", { condition: stringAttr("=bad") })],
    );
    const diags = validate(graph);
    const condErrors = diags.filter((d) => d.rule === "condition_syntax");
    expect(condErrors.length).toBe(1);
  });
});

describe("stylesheet_syntax rule", () => {
  test("balanced braces produce no error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "done")],
      { model_stylesheet: stringAttr("node { model: gpt-4; }") },
    );
    const diags = validate(graph);
    const ssErrors = diags.filter((d) => d.rule === "stylesheet_syntax");
    expect(ssErrors.length).toBe(0);
  });

  test("unbalanced braces produce error", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "done")],
      { model_stylesheet: stringAttr("node { model: gpt-4;") },
    );
    const diags = validate(graph);
    const ssErrors = diags.filter((d) => d.rule === "stylesheet_syntax");
    expect(ssErrors.length).toBe(1);
  });
});

describe("type_known rule", () => {
  test("unrecognized type produces warning", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { type: stringAttr("unknown_handler"), prompt: stringAttr("x") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "task"), makeEdge("task", "done")],
    );
    const diags = validate(graph);
    const typeWarnings = diags.filter((d) => d.rule === "type_known");
    expect(typeWarnings.length).toBe(1);
    expect(typeWarnings[0]?.severity).toBe(Severity.WARNING);
  });
});

describe("fidelity_valid rule", () => {
  test("invalid fidelity mode produces warning", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { shape: stringAttr("box"), prompt: stringAttr("x"), fidelity: stringAttr("invalid") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "task"), makeEdge("task", "done")],
    );
    const diags = validate(graph);
    const fidWarnings = diags.filter((d) => d.rule === "fidelity_valid");
    expect(fidWarnings.length).toBe(1);
    expect(fidWarnings[0]?.severity).toBe(Severity.WARNING);
  });
});

describe("retry_target_exists rule", () => {
  test("retry_target referencing nonexistent node produces warning", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { shape: stringAttr("box"), prompt: stringAttr("x"), retry_target: stringAttr("ghost") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "task"), makeEdge("task", "done")],
    );
    const diags = validate(graph);
    const retryWarnings = diags.filter((d) => d.rule === "retry_target_exists");
    expect(retryWarnings.length).toBe(1);
  });
});

describe("goal_gate_has_retry rule", () => {
  test("goal_gate without retry_target produces warning", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { shape: stringAttr("box"), prompt: stringAttr("x"), goal_gate: booleanAttr(true) }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "task"), makeEdge("task", "done")],
    );
    const diags = validate(graph);
    const ggWarnings = diags.filter((d) => d.rule === "goal_gate_has_retry");
    expect(ggWarnings.length).toBe(1);
  });
});

describe("prompt_on_llm_nodes rule", () => {
  test("codergen node without prompt or label produces warning", () => {
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("task", { shape: stringAttr("box") }),
        makeNode("done", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "task"), makeEdge("task", "done")],
    );
    const diags = validate(graph);
    const promptWarnings = diags.filter((d) => d.rule === "prompt_on_llm_nodes");
    expect(promptWarnings.length).toBe(1);
  });
});

describe("valid graph", () => {
  test("produces no errors", () => {
    const diags = validate(validGraph());
    const errors = diags.filter((d) => d.severity === Severity.ERROR);
    expect(errors.length).toBe(0);
  });
});

describe("validateOrRaise", () => {
  test("throws ValidationError on errors", () => {
    const graph = makeGraph([], []);
    expect(() => validateOrRaise(graph)).toThrow(ValidationError);
  });

  test("returns warnings without throwing", () => {
    const graph = validGraph();
    // Add a node with invalid fidelity to get a warning
    graph.nodes.set("extra", makeNode("extra", {
      shape: stringAttr("box"),
      prompt: stringAttr("x"),
      fidelity: stringAttr("bad"),
    }));
    graph.edges.push(makeEdge("start", "extra"), makeEdge("extra", "done"));
    const diags = validateOrRaise(graph);
    expect(diags.some((d) => d.severity === Severity.WARNING)).toBe(true);
  });

  test("does not throw on valid graph", () => {
    expect(() => validateOrRaise(validGraph())).not.toThrow();
  });
});
