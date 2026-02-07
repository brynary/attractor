import { describe, it, expect } from "bun:test";
import { FanInHandler } from "../../src/handlers/fan-in.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import type { Node, Graph } from "../../src/types/graph.js";

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeGraph(): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges: [] };
}

function makeResults(entries: Array<{ nodeId: string; status: string }>): string {
  return JSON.stringify(
    entries.map((e) => ({ nodeId: e.nodeId, status: e.status, notes: "", contextUpdates: {} })),
  );
}

describe("FanInHandler", () => {
  it("selects the best candidate by status rank", async () => {
    const handler = new FanInHandler();
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "b", status: StageStatus.PARTIAL_SUCCESS },
        { nodeId: "a", status: StageStatus.SUCCESS },
      ]),
    );

    const outcome = await handler.execute(makeNode("fanin"), context, makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("a");
    expect(outcome.contextUpdates["parallel.fan_in.best_outcome"]).toBe(StageStatus.SUCCESS);
  });

  it("breaks ties by node id", async () => {
    const handler = new FanInHandler();
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "c", status: StageStatus.SUCCESS },
        { nodeId: "a", status: StageStatus.SUCCESS },
      ]),
    );

    const outcome = await handler.execute(makeNode("fanin"), context, makeGraph(), "/tmp");
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("a");
  });

  it("fails when no parallel results in context", async () => {
    const handler = new FanInHandler();
    const context = new Context();

    const outcome = await handler.execute(makeNode("fanin"), context, makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("No parallel results");
  });

  it("fails when all candidates failed", async () => {
    const handler = new FanInHandler();
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "a", status: StageStatus.FAIL },
        { nodeId: "b", status: StageStatus.FAIL },
      ]),
    );

    const outcome = await handler.execute(makeNode("fanin"), context, makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("All parallel candidates failed");
  });

  it("selects partial_success over fail", async () => {
    const handler = new FanInHandler();
    const context = new Context();
    context.set(
      "parallel.results",
      makeResults([
        { nodeId: "a", status: StageStatus.FAIL },
        { nodeId: "b", status: StageStatus.PARTIAL_SUCCESS },
      ]),
    );

    const outcome = await handler.execute(makeNode("fanin"), context, makeGraph(), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates["parallel.fan_in.best_id"]).toBe("b");
  });
});
