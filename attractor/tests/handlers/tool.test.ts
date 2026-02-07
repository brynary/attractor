import { describe, it, expect } from "bun:test";
import { ToolHandler } from "../../src/handlers/tool.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr } from "../../src/types/graph.js";
import type { Node, Graph, AttributeValue } from "../../src/types/graph.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map<string, AttributeValue>();
  for (const [k, v] of Object.entries(attrs)) {
    attributes.set(k, stringAttr(v));
  }
  return { id, attributes };
}

function makeGraph(): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges: [] };
}

describe("ToolHandler", () => {
  it("executes a command and captures stdout", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool", { tool_command: "echo hello" });

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
    const output = outcome.contextUpdates["tool.output"] ?? "";
    expect(output.trim()).toBe("hello");
  });

  it("fails when no tool_command specified", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool");

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("No tool_command specified");
  });

  it("fails when command exits with non-zero code", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool", { tool_command: "exit 1" });

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("exited with code 1");
  });

  it("includes command in notes on success", async () => {
    const handler = new ToolHandler();
    const node = makeNode("tool", { tool_command: "echo ok" });

    const outcome = await handler.execute(node, new Context(), makeGraph(), "/tmp");
    expect(outcome.notes).toContain("echo ok");
  });
});
