import { describe, it, expect } from "bun:test";
import { ConditionalHandler } from "../../src/handlers/conditional.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import type { Node, Graph } from "../../src/types/graph.js";

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeGraph(): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges: [] };
}

describe("ConditionalHandler", () => {
  it("returns SUCCESS", async () => {
    const handler = new ConditionalHandler();
    const outcome = await handler.execute(
      makeNode("check"),
      new Context(),
      makeGraph(),
      "/tmp",
    );
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("includes node id in notes", async () => {
    const handler = new ConditionalHandler();
    const outcome = await handler.execute(
      makeNode("my_branch"),
      new Context(),
      makeGraph(),
      "/tmp",
    );
    expect(outcome.notes).toContain("my_branch");
  });
});
