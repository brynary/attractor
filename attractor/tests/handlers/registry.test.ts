import { describe, it, expect } from "bun:test";
import { HandlerRegistry } from "../../src/handlers/registry.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr } from "../../src/types/graph.js";
import type { Handler } from "../../src/types/handler.js";
import type { Node, Graph, AttributeValue } from "../../src/types/graph.js";
import type { Outcome } from "../../src/types/outcome.js";

class StubHandler implements Handler {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  async execute(_node: Node, _context: Context, _graph: Graph, _logsRoot: string): Promise<Outcome> {
    return createOutcome({ status: StageStatus.SUCCESS, notes: this.name });
  }
}

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map<string, AttributeValue>();
  for (const [k, v] of Object.entries(attrs)) {
    attributes.set(k, stringAttr(v));
  }
  return { id, attributes };
}

describe("HandlerRegistry", () => {
  it("resolves by explicit type attribute", async () => {
    const defaultHandler = new StubHandler("default");
    const registry = new HandlerRegistry(defaultHandler);
    const waitHandler = new StubHandler("wait.human");
    registry.register("wait.human", waitHandler);

    const node = makeNode("gate", { type: "wait.human" });
    const resolved = registry.resolve(node);
    const outcome = await resolved.execute(node, new Context(), { name: "test", attributes: new Map(), nodes: new Map(), edges: [] }, "/tmp");
    expect(outcome.notes).toBe("wait.human");
  });

  it("resolves by shape when no explicit type", async () => {
    const defaultHandler = new StubHandler("default");
    const registry = new HandlerRegistry(defaultHandler);
    const startHandler = new StubHandler("start");
    registry.register("start", startHandler);

    const node = makeNode("begin", { shape: "Mdiamond" });
    const resolved = registry.resolve(node);
    const outcome = await resolved.execute(node, new Context(), { name: "test", attributes: new Map(), nodes: new Map(), edges: [] }, "/tmp");
    expect(outcome.notes).toBe("start");
  });

  it("falls back to default handler", async () => {
    const defaultHandler = new StubHandler("default");
    const registry = new HandlerRegistry(defaultHandler);

    const node = makeNode("some_node");
    const resolved = registry.resolve(node);
    const outcome = await resolved.execute(node, new Context(), { name: "test", attributes: new Map(), nodes: new Map(), edges: [] }, "/tmp");
    expect(outcome.notes).toBe("default");
  });

  it("maps all shapes correctly", async () => {
    const defaultHandler = new StubHandler("default");
    const registry = new HandlerRegistry(defaultHandler);

    const mappings: Array<[string, string]> = [
      ["Mdiamond", "start"],
      ["Msquare", "exit"],
      ["box", "codergen"],
      ["hexagon", "wait.human"],
      ["diamond", "conditional"],
      ["component", "parallel"],
      ["tripleoctagon", "parallel.fan_in"],
      ["parallelogram", "tool"],
      ["house", "stack.manager_loop"],
    ];

    for (const [shape, type] of mappings) {
      const handler = new StubHandler(type);
      registry.register(type, handler);
    }

    for (const [shape, expectedType] of mappings) {
      const node = makeNode("n", { shape });
      const resolved = registry.resolve(node);
      const outcome = await resolved.execute(node, new Context(), { name: "test", attributes: new Map(), nodes: new Map(), edges: [] }, "/tmp");
      expect(outcome.notes).toBe(expectedType);
    }
  });

  it("explicit type takes precedence over shape", async () => {
    const defaultHandler = new StubHandler("default");
    const registry = new HandlerRegistry(defaultHandler);
    const codergenHandler = new StubHandler("codergen");
    const customHandler = new StubHandler("custom");
    registry.register("codergen", codergenHandler);
    registry.register("custom", customHandler);

    // Node has box shape (maps to codergen) but explicit type=custom
    const node = makeNode("n", { shape: "box", type: "custom" });
    const resolved = registry.resolve(node);
    const outcome = await resolved.execute(node, new Context(), { name: "test", attributes: new Map(), nodes: new Map(), edges: [] }, "/tmp");
    expect(outcome.notes).toBe("custom");
  });

  it("register replaces existing handler", async () => {
    const defaultHandler = new StubHandler("default");
    const registry = new HandlerRegistry(defaultHandler);
    registry.register("start", new StubHandler("old"));
    registry.register("start", new StubHandler("new"));

    const node = makeNode("n", { type: "start" });
    const resolved = registry.resolve(node);
    const outcome = await resolved.execute(node, new Context(), { name: "test", attributes: new Map(), nodes: new Map(), edges: [] }, "/tmp");
    expect(outcome.notes).toBe("new");
  });
});
