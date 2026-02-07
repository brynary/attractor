import { describe, it, expect } from "bun:test";
import { ExitHandler } from "../../src/handlers/exit.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import type { Node, Graph } from "../../src/types/graph.js";

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeGraph(): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges: [] };
}

describe("ExitHandler", () => {
  it("returns SUCCESS", async () => {
    const handler = new ExitHandler();
    const outcome = await handler.execute(makeNode("exit"), new Context(), makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("returns empty suggested next ids", async () => {
    const handler = new ExitHandler();
    const outcome = await handler.execute(makeNode("exit"), new Context(), makeGraph(), "/tmp");
    expect(outcome.suggestedNextIds).toEqual([]);
  });

  it("returns empty context updates", async () => {
    const handler = new ExitHandler();
    const outcome = await handler.execute(makeNode("exit"), new Context(), makeGraph(), "/tmp");
    expect(outcome.contextUpdates).toEqual({});
  });
});
