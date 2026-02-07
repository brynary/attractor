import { describe, expect, test } from "bun:test";
import {
  PipelineRunner,
  createHandlerRegistry,
} from "../../src/engine/runner.js";
import type { PipelineEvent } from "../../src/types/events.js";
import { Context } from "../../src/types/context.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Handler } from "../../src/types/handler.js";
import type { Graph, Node, Edge, AttributeValue } from "../../src/types/graph.js";
import { stringAttr, integerAttr, booleanAttr } from "../../src/types/graph.js";

function makeNode(
  id: string,
  attrs: Record<string, AttributeValue> = {},
): Node {
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
  for (const n of nodes) nodeMap.set(n.id, n);
  return {
    name: "test",
    attributes: new Map(Object.entries(graphAttrs)),
    nodes: nodeMap,
    edges,
  };
}

function successHandler(): Handler {
  return {
    execute: async () => createOutcome({ status: StageStatus.SUCCESS }),
  };
}

function recordingHandler(records: string[]): Handler {
  return {
    execute: async (node) => {
      records.push(node.id);
      return createOutcome({ status: StageStatus.SUCCESS });
    },
  };
}

describe("PipelineRunner", () => {
  test("runs a linear pipeline start -> work -> exit", async () => {
    const records: string[] = [];
    const registry = createHandlerRegistry();
    registry.register("start", recordingHandler(records));
    registry.register("codergen", recordingHandler(records));
    registry.register("exit", recordingHandler(records));

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("work", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "work"), makeEdge("work", "exit")],
      { goal: stringAttr("test pipeline") },
    );

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: "/tmp/attractor-runner-test",
    });

    const result = await runner.run(graph);
    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(result.completedNodes).toEqual(["start", "work"]);
    expect(result.context.get("graph.goal")).toBe("test pipeline");
    expect(records).toEqual(["start", "work"]);
  });

  test("handles conditional branching", async () => {
    const records: string[] = [];
    const registry = createHandlerRegistry();
    registry.register("start", recordingHandler(records));
    registry.register("exit", recordingHandler(records));
    registry.register("conditional", recordingHandler(records));
    registry.register("codergen", recordingHandler(records));

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("gate", { shape: stringAttr("diamond") }),
        makeNode("path_a", { shape: stringAttr("box") }),
        makeNode("path_b", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "gate"),
        makeEdge("gate", "path_a", { condition: stringAttr("outcome=success") }),
        makeEdge("gate", "path_b", { condition: stringAttr("outcome=fail") }),
        makeEdge("path_a", "exit"),
        makeEdge("path_b", "exit"),
      ],
    );

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: "/tmp/attractor-runner-test",
    });

    const result = await runner.run(graph);
    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // gate returns SUCCESS, so condition outcome=success matches, go to path_a
    expect(result.completedNodes).toContain("path_a");
    expect(result.completedNodes).not.toContain("path_b");
  });

  test("emits events", async () => {
    const events: PipelineEvent[] = [];
    const emitter = { emit: (e: PipelineEvent) => events.push(e) };

    const registry = createHandlerRegistry();
    registry.register("start", successHandler());
    registry.register("exit", successHandler());

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "exit")],
    );

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      eventEmitter: emitter,
      logsRoot: "/tmp/attractor-runner-test",
    });

    await runner.run(graph);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("pipeline_started");
    expect(kinds).toContain("stage_started");
    expect(kinds).toContain("stage_completed");
    expect(kinds).toContain("pipeline_completed");
  });

  test("goal gate enforcement redirects to retry target", async () => {
    let validateCallCount = 0;
    const registry = createHandlerRegistry();
    registry.register("start", successHandler());
    registry.register("exit", successHandler());
    registry.register("codergen", {
      execute: async (node) => {
        if (node.id === "validate") {
          validateCallCount++;
          // Fail first time, succeed second time
          if (validateCallCount === 1) {
            return createOutcome({
              status: StageStatus.FAIL,
              failureReason: "tests failed",
            });
          }
          return createOutcome({ status: StageStatus.SUCCESS });
        }
        return createOutcome({ status: StageStatus.SUCCESS });
      },
    });

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("implement", { shape: stringAttr("box") }),
        makeNode("validate", {
          shape: stringAttr("box"),
          goal_gate: booleanAttr(true),
          retry_target: stringAttr("implement"),
        }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "implement"),
        makeEdge("implement", "validate"),
        makeEdge("validate", "exit"),
      ],
    );

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: "/tmp/attractor-runner-test",
    });

    const result = await runner.run(graph);
    // validate failed -> goal gate unsatisfied -> redirect to implement -> validate again -> success
    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(validateCallCount).toBe(2);
  });

  test("fails when no handler found", async () => {
    const registry = createHandlerRegistry();
    registry.register("start", successHandler());
    // No codergen handler registered, no default

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("work", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "work"), makeEdge("work", "exit")],
    );

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: "/tmp/attractor-runner-test",
    });

    const result = await runner.run(graph);
    expect(result.outcome.status).toBe(StageStatus.FAIL);
    expect(result.outcome.failureReason).toContain("No handler found");
  });

  test("applies transforms before execution", async () => {
    const registry = createHandlerRegistry();
    registry.register("start", successHandler());
    registry.register("exit", successHandler());

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "exit")],
    );

    const transforms = [
      {
        apply: (g: Graph) => ({
          ...g,
          attributes: new Map([
            ...g.attributes,
            ["goal", stringAttr("transformed")],
          ]),
        }),
      },
    ];

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      transforms,
      logsRoot: "/tmp/attractor-runner-test",
    });

    const result = await runner.run(graph);
    expect(result.context.get("graph.goal")).toBe("transformed");
  });

  test("context updates are applied from outcomes", async () => {
    const registry = createHandlerRegistry();
    registry.register("start", successHandler());
    registry.register("exit", successHandler());
    registry.register("codergen", {
      execute: async () =>
        createOutcome({
          status: StageStatus.SUCCESS,
          contextUpdates: { "context.feature": "implemented" },
        }),
    });

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("work", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [makeEdge("start", "work"), makeEdge("work", "exit")],
    );

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: "/tmp/attractor-runner-test",
    });

    const result = await runner.run(graph);
    expect(result.context.get("context.feature")).toBe("implemented");
  });
});
