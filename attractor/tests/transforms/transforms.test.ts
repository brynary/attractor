import { describe, expect, test } from "bun:test";
import { VariableExpansionTransform } from "../../src/transforms/variable-expansion.js";
import { StylesheetTransform } from "../../src/transforms/stylesheet-transform.js";
import { TransformRegistry } from "../../src/transforms/registry.js";
import type { Graph, Node, Transform } from "../../src/types/index.js";
import { stringAttr, getStringAttr } from "../../src/types/index.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map(
    Object.entries(attrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { id, attributes };
}

function makeGraph(
  nodes: Node[],
  graphAttrs: Record<string, string> = {},
): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const attributes = new Map(
    Object.entries(graphAttrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { name: "test", attributes, nodes: nodeMap, edges: [] };
}

describe("VariableExpansionTransform", () => {
  test("replaces $goal in node prompt attributes", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "Implement $goal using TDD" })],
      { goal: "user authentication" },
    );

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("Implement user authentication using TDD");
  });

  test("replaces multiple occurrences of $goal", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "$goal: plan $goal" })],
      { goal: "feature X" },
    );

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("feature X: plan feature X");
  });

  test("leaves nodes without prompt unchanged", () => {
    const graph = makeGraph(
      [makeNode("a", { label: "Plan" })],
      { goal: "feature X" },
    );

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("a")?.attributes.has("prompt")).toBe(false);
    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "label"),
    ).toBe("Plan");
  });

  test("returns graph unchanged when no goal attribute", () => {
    const graph = makeGraph([makeNode("a", { prompt: "Do $goal" })]);

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(result).toBe(graph);
  });
});

describe("StylesheetTransform", () => {
  test("applies model_stylesheet to nodes", () => {
    const graph = makeGraph(
      [makeNode("plan"), makeNode("implement", { class: "code" })],
      {
        model_stylesheet: `
          * { llm_model: claude-sonnet-4-5; llm_provider: anthropic; }
          .code { llm_model: claude-opus-4-6; }
        `,
      },
    );

    const transform = new StylesheetTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("plan")?.attributes ?? new Map(), "llm_model"),
    ).toBe("claude-sonnet-4-5");
    expect(
      getStringAttr(result.nodes.get("implement")?.attributes ?? new Map(), "llm_model"),
    ).toBe("claude-opus-4-6");
    expect(
      getStringAttr(result.nodes.get("implement")?.attributes ?? new Map(), "llm_provider"),
    ).toBe("anthropic");
  });

  test("returns graph unchanged when no model_stylesheet", () => {
    const graph = makeGraph([makeNode("a")]);

    const transform = new StylesheetTransform();
    const result = transform.apply(graph);

    expect(result).toBe(graph);
  });
});

describe("TransformRegistry", () => {
  test("applies transforms in registration order", () => {
    const applied: string[] = [];

    const transformA: Transform = {
      apply(graph: Graph): Graph {
        applied.push("A");
        return graph;
      },
    };
    const transformB: Transform = {
      apply(graph: Graph): Graph {
        applied.push("B");
        return graph;
      },
    };

    const registry = new TransformRegistry();
    registry.register(transformA);
    registry.register(transformB);
    registry.apply(makeGraph([]));

    expect(applied).toEqual(["A", "B"]);
  });

  test("passes output of one transform as input to the next", () => {
    const registry = new TransformRegistry();
    registry.register(new VariableExpansionTransform());
    registry.register(new StylesheetTransform());

    const graph = makeGraph(
      [makeNode("a", { prompt: "Do $goal" })],
      {
        goal: "feature X",
        model_stylesheet: "* { llm_model: claude-sonnet-4-5; }",
      },
    );

    const result = registry.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("Do feature X");
    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model"),
    ).toBe("claude-sonnet-4-5");
  });
});
