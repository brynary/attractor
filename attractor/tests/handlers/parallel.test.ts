import { describe, it, expect } from "bun:test";
import { ParallelHandler } from "../../src/handlers/parallel.js";
import type { NodeExecutor } from "../../src/handlers/parallel.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr, integerAttr, floatAttr } from "../../src/types/graph.js";
import type { Node, Graph, Edge, AttributeValue } from "../../src/types/graph.js";
import type { PipelineEvent } from "../../src/types/events.js";
import { PipelineEventKind } from "../../src/types/events.js";
import type { EventEmitter } from "../../src/engine/runner.js";

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeEdge(from: string, to: string): Edge {
  return { from, to, attributes: new Map<string, AttributeValue>() };
}

function makeGraph(edges: Edge[]): Graph {
  return { name: "test", attributes: new Map(), nodes: new Map(), edges, subgraphs: [] };
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
    const raw = context.getString("parallel.results");
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
      const nested = ctx.get("nested") as { count: number } | undefined;
      if (nested) {
        nested.count += 1;
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    };

    const handler = new ParallelHandler(executor);
    const node = makeNode("parallel");
    const edges = [makeEdge("parallel", "a"), makeEdge("parallel", "b")];
    const parentContext = new Context();
    parentContext.set("shared", "value");
    parentContext.set("nested", { count: 0 });

    await handler.execute(node, parentContext, makeGraph(edges), "/tmp");
    // Each branch context should be a distinct clone
    expect(contexts.length).toBe(2);
    expect(contexts[0]).not.toBe(parentContext);
    expect(contexts[1]).not.toBe(parentContext);
    expect(contexts[0]).not.toBe(contexts[1]);
    // But share same values
    expect(contexts[0]?.get("shared")).toBe("value");
    expect(contexts[1]?.get("shared")).toBe("value");
    // Nested objects are deep-cloned so branch mutations do not leak.
    expect((parentContext.get("nested") as { count: number }).count).toBe(0);
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

function makeNodeWithAttrs(id: string, attrs: Map<string, AttributeValue>): Node {
  return { id, attributes: attrs };
}

describe("ParallelHandler advanced policies", () => {
  it("wait_all default: all pass returns SUCCESS", async () => {
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.SUCCESS });

    const handler = new ParallelHandler(executor);
    const node = makeNode("p");
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("wait_all default: some fail returns PARTIAL_SUCCESS", async () => {
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.SUCCESS],
      ["b", StageStatus.FAIL],
      ["c", StageStatus.SUCCESS],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: outcomes.get(nodeId) ?? StageStatus.FAIL });

    const handler = new ParallelHandler(executor);
    const node = makeNode("p");
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.PARTIAL_SUCCESS);
  });

  it("k_of_n: K successes met returns SUCCESS", async () => {
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.SUCCESS],
      ["b", StageStatus.FAIL],
      ["c", StageStatus.SUCCESS],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: outcomes.get(nodeId) ?? StageStatus.FAIL });

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["join_policy", stringAttr("k_of_n")],
      ["join_k", integerAttr(2)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("k_of_n: impossible to reach K returns FAIL", async () => {
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.FAIL, failureReason: "nope" });

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["join_policy", stringAttr("k_of_n")],
      ["join_k", integerAttr(3)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
  });

  it("first_success: one succeeds returns SUCCESS", async () => {
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.FAIL],
      ["b", StageStatus.SUCCESS],
      ["c", StageStatus.FAIL],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: outcomes.get(nodeId) ?? StageStatus.FAIL });

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["join_policy", stringAttr("first_success")],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("quorum: majority met returns SUCCESS", async () => {
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.SUCCESS],
      ["b", StageStatus.FAIL],
      ["c", StageStatus.SUCCESS],
      ["d", StageStatus.FAIL],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: outcomes.get(nodeId) ?? StageStatus.FAIL });

    const handler = new ParallelHandler(executor);
    // quorum with 0.5 fraction => ceil(0.5 * 4) = 2 successes needed
    const attrs = new Map<string, AttributeValue>([
      ["join_policy", stringAttr("quorum")],
      ["join_k", floatAttr(0.5)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c"), makeEdge("p", "d")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("fail_fast: stops on first failure", async () => {
    let executedCount = 0;
    const executor: NodeExecutor = async (nodeId) => {
      executedCount++;
      if (nodeId === "a") {
        return createOutcome({ status: StageStatus.FAIL, failureReason: "boom" });
      }
      return createOutcome({ status: StageStatus.SUCCESS });
    };

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["error_policy", stringAttr("fail_fast")],
      ["max_parallel", integerAttr(1)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.FAIL);
    // With max_parallel=1 and fail_fast, should stop after first failure
    expect(executedCount).toBe(1);
  });

  it("ignore: all failures still returns SUCCESS", async () => {
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.FAIL, failureReason: "error" });

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["error_policy", stringAttr("ignore")],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b")];
    const context = new Context();

    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("bounded parallelism: max_parallel limits concurrent execution", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const executor: NodeExecutor = async () => {
      concurrent++;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return createOutcome({ status: StageStatus.SUCCESS });
    };

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["max_parallel", integerAttr(2)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c"), makeEdge("p", "d")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThan(0);
  });

  it("serialized results in context contain correct structure", async () => {
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.SUCCESS],
      ["b", StageStatus.FAIL],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({
        status: outcomes.get(nodeId) ?? StageStatus.FAIL,
        notes: "note-" + nodeId,
        contextUpdates: { key: nodeId },
      });

    const handler = new ParallelHandler(executor);
    const attrs = new Map<string, AttributeValue>([
      ["error_policy", stringAttr("ignore")],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");
    const raw = context.getString("parallel.results");
    const results = JSON.parse(raw) as Array<{ nodeId: string; status: string; notes: string; contextUpdates: Record<string, string> }>;
    expect(results.length).toBe(2);

    const resultA = results.find((r) => r.nodeId === "a");
    const resultB = results.find((r) => r.nodeId === "b");
    expect(resultA?.status).toBe(StageStatus.SUCCESS);
    expect(resultA?.notes).toBe("note-a");
    expect(resultA?.contextUpdates.key).toBe("a");
    expect(resultB?.status).toBe(StageStatus.FAIL);
  });
});

function createStubEmitter(): { emitter: EventEmitter; events: PipelineEvent[] } {
  const events: PipelineEvent[] = [];
  const emitter: EventEmitter = { emit: (event) => { events.push(event); } };
  return { emitter, events };
}

describe("ParallelHandler event emission", () => {
  it("emits PARALLEL_STARTED, PARALLEL_BRANCH_STARTED/COMPLETED, and PARALLEL_COMPLETED for wait_all", async () => {
    const { emitter, events } = createStubEmitter();
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.SUCCESS });

    const handler = new ParallelHandler(executor, emitter, "test-pipeline");
    const node = makeNode("p");
    const edges = [makeEdge("p", "a"), makeEdge("p", "b")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe(PipelineEventKind.PARALLEL_STARTED);
    expect(kinds[kinds.length - 1]).toBe(PipelineEventKind.PARALLEL_COMPLETED);

    // Verify PARALLEL_STARTED data
    const startEvent = events[0];
    expect(startEvent?.data).toEqual({ branchCount: 2 });
    expect(startEvent?.pipelineId).toBe("test-pipeline");

    // Verify branch events: 2 started + 2 completed
    const branchStarted = events.filter((e) => e.kind === PipelineEventKind.PARALLEL_BRANCH_STARTED);
    const branchCompleted = events.filter((e) => e.kind === PipelineEventKind.PARALLEL_BRANCH_COMPLETED);
    expect(branchStarted.length).toBe(2);
    expect(branchCompleted.length).toBe(2);

    // Verify PARALLEL_COMPLETED data
    const completedEvent = events[events.length - 1];
    expect(completedEvent?.data).toEqual({ successCount: 2, failureCount: 0 });
  });

  it("emits events for first_success policy", async () => {
    const { emitter, events } = createStubEmitter();
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.SUCCESS],
      ["b", StageStatus.SUCCESS],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: outcomes.get(nodeId) ?? StageStatus.FAIL });

    const handler = new ParallelHandler(executor, emitter, "test-pipeline");
    const attrs = new Map<string, AttributeValue>([
      ["join_policy", stringAttr("first_success")],
      ["max_parallel", integerAttr(1)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe(PipelineEventKind.PARALLEL_STARTED);
    expect(kinds[kinds.length - 1]).toBe(PipelineEventKind.PARALLEL_COMPLETED);

    const branchStarted = events.filter((e) => e.kind === PipelineEventKind.PARALLEL_BRANCH_STARTED);
    expect(branchStarted.length).toBeGreaterThanOrEqual(1);
  });

  it("emits events for k_of_n policy", async () => {
    const { emitter, events } = createStubEmitter();
    const outcomes = new Map<string, StageStatus>([
      ["a", StageStatus.SUCCESS],
      ["b", StageStatus.FAIL],
      ["c", StageStatus.SUCCESS],
    ]);
    const executor: NodeExecutor = async (nodeId) =>
      createOutcome({ status: outcomes.get(nodeId) ?? StageStatus.FAIL });

    const handler = new ParallelHandler(executor, emitter, "test-pipeline");
    const attrs = new Map<string, AttributeValue>([
      ["join_policy", stringAttr("k_of_n")],
      ["join_k", integerAttr(2)],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a"), makeEdge("p", "b"), makeEdge("p", "c")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe(PipelineEventKind.PARALLEL_STARTED);
    expect(kinds[kinds.length - 1]).toBe(PipelineEventKind.PARALLEL_COMPLETED);

    const branchCompleted = events.filter((e) => e.kind === PipelineEventKind.PARALLEL_BRANCH_COMPLETED);
    expect(branchCompleted.length).toBeGreaterThanOrEqual(2);
  });

  it("does not emit events when no emitter is provided", async () => {
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.SUCCESS });

    const handler = new ParallelHandler(executor);
    const node = makeNode("p");
    const edges = [makeEdge("p", "a")];
    const context = new Context();

    // Should not throw
    const outcome = await handler.execute(node, context, makeGraph(edges), "/tmp");
    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("reports branch success=false for failed branches", async () => {
    const { emitter, events } = createStubEmitter();
    const executor: NodeExecutor = async () =>
      createOutcome({ status: StageStatus.FAIL, failureReason: "error" });

    const handler = new ParallelHandler(executor, emitter, "test-pipeline");
    const attrs = new Map<string, AttributeValue>([
      ["error_policy", stringAttr("ignore")],
    ]);
    const node = makeNodeWithAttrs("p", attrs);
    const edges = [makeEdge("p", "a")];
    const context = new Context();

    await handler.execute(node, context, makeGraph(edges), "/tmp");

    const branchCompleted = events.filter((e) => e.kind === PipelineEventKind.PARALLEL_BRANCH_COMPLETED);
    expect(branchCompleted.length).toBe(1);
    expect(branchCompleted[0]?.data).toEqual({ branch: "a", success: false });

    const completed = events.filter((e) => e.kind === PipelineEventKind.PARALLEL_COMPLETED);
    expect(completed.length).toBe(1);
    expect(completed[0]?.data).toEqual({ successCount: 0, failureCount: 1 });
  });
});
