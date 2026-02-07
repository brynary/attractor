import { describe, it, expect } from "bun:test";
import { ParallelHandler } from "../../src/handlers/parallel.js";
import type { NodeExecutor } from "../../src/handlers/parallel.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr } from "../../src/types/graph.js";
import type { Node, Graph, Edge, AttributeValue } from "../../src/types/graph.js";

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeEdge(from: string, to: string): Edge {
  return { from, to, attributes: new Map<string, AttributeValue>() };
}

function makeGraph(edges: Edge[]): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges };
}

describe("ParallelHandler", () => {
  it("returns SUCCESS when all branches succeed", async () => {
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.SUCCESS });

    const handler = new ParallelHandler(executor);
    const node = makeNode("parallel");
    const edges = [makeEdge("parallel", "a"), makeEdge("parallel", "b")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("returns PARTIAL_SUCCESS when some branches fail", async () => {
    let callCount = 0;
    const executor: NodeExecutor = async () => {
      callCount++;
      if (callCount === 1) {
        return createOutcome({ status: StageStatus.SUCCESS });
      }
      return createOutcome({ status: StageStatus.FAIL, failureReason: "error" });
    };

    const handler = new ParallelHandler(executor);
    const node = makeNode("parallel");
    const edges = [makeEdge("parallel", "a"), makeEdge("parallel", "b")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.PARTIAL_SUCCESS);
  });

  it("stores results in context for fan-in", async () => {
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: StageStatus.SUCCESS, notes: "done: " + nodeId });

    const handler = new ParallelHandler(executor);
    const node = makeNode("parallel");
    const edges = [makeEdge("parallel", "a"), makeEdge("parallel", "b")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");
    const raw = context.get("parallel.results");
    expect(raw).not.toBe("");
    const results = JSON.parse(raw);
    expect(results.length).toBe(2);
    expect(results[0].nodeId).toBe("a");
    expect(results[1].nodeId).toBe("b");
  });

  it("clones context for each branch", async () => {
    const contexts: Context[] = [];
    const executor: NodeExecutor = async (_nodeId, ctx) => {
      contexts.push(ctx);
      return createOutcome({ status: StageStatus.SUCCESS });
    };

    const handler = new ParallelHandler(executor);
    const node = makeNode("parallel");
    const edges = [makeEdge("parallel", "a"), makeEdge("parallel", "b")];
    const parentContext = new Context();
    parentContext.set("shared", "value");

    await handler.execute(node, parentContext, makeGraph(edges), "/tmp");
    // Each branch context should be a distinct clone
    expect(contexts.length).toBe(2);
    expect(contexts[0]).not.toBe(parentContext);
    expect(contexts[1]).not.toBe(parentContext);
    expect(contexts[0]).not.toBe(contexts[1]);
    // But share same values
    expect(contexts[0]?.get("shared")).toBe("value");
    expect(contexts[1]?.get("shared")).toBe("value");
  });

  it("fails when no outgoing edges", async () => {
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.SUCCESS });

    const handler = new ParallelHandler(executor);
    const node = makeNode("parallel");
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph([]), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
  });
});
