import { describe, expect, test } from "bun:test";
import { applyStylesheet } from "../../src/stylesheet/apply.js";
import type {
  Graph,
  Node,
  StylesheetRule,
} from "../../src/types/index.js";
import { stringAttr, getStringAttr } from "../../src/types/index.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map(
    Object.entries(attrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { id, attributes };
}

function makeGraph(nodes: Node[], graphAttrs: Record<string, string> = {}): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const attributes = new Map(
    Object.entries(graphAttrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { name: "test", attributes, nodes: nodeMap, edges: [] };
}

describe("applyStylesheet", () => {
  test("applies universal rule to all nodes", () => {
    const graph = makeGraph([makeNode("a"), makeNode("b")]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "claude-sonnet-4-5" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "claude-sonnet-4-5",
    );
    expect(getStringAttr(result.nodes.get("b")?.attributes ?? new Map(), "llm_model")).toBe(
      "claude-sonnet-4-5",
    );
  });

  test("class rule overrides universal rule", () => {
    const graph = makeGraph([
      makeNode("a", { class: "code" }),
      makeNode("b"),
    ]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "claude-sonnet-4-5" }],
      },
      {
        selector: { kind: "class", value: "code", specificity: 1 },
        declarations: [{ property: "llm_model", value: "claude-opus-4-6" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "claude-opus-4-6",
    );
    expect(getStringAttr(result.nodes.get("b")?.attributes ?? new Map(), "llm_model")).toBe(
      "claude-sonnet-4-5",
    );
  });

  test("ID rule overrides class rule", () => {
    const graph = makeGraph([makeNode("review", { class: "code" })]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "class", value: "code", specificity: 1 },
        declarations: [{ property: "llm_model", value: "claude-opus-4-6" }],
      },
      {
        selector: { kind: "id", value: "review", specificity: 2 },
        declarations: [{ property: "llm_model", value: "gpt-5.2" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("review")?.attributes ?? new Map(), "llm_model")).toBe(
      "gpt-5.2",
    );
  });

  test("explicit node attributes override stylesheet rules", () => {
    const graph = makeGraph([
      makeNode("a", { llm_model: "my-custom-model" }),
    ]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "claude-sonnet-4-5" }],
      },
      {
        selector: { kind: "id", value: "a", specificity: 2 },
        declarations: [{ property: "llm_model", value: "gpt-5.2" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "my-custom-model",
    );
  });

  test("matches comma-separated class list", () => {
    const graph = makeGraph([makeNode("a", { class: "planning, code" })]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "class", value: "code", specificity: 1 },
        declarations: [{ property: "llm_model", value: "claude-opus-4-6" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "claude-opus-4-6",
    );
  });

  test("later rules of equal specificity override earlier ones", () => {
    const graph = makeGraph([makeNode("a")]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "first" }],
      },
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "second" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "second",
    );
  });
});
