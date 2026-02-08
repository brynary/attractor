import { describe, expect, test, afterEach } from "bun:test";
import {
  PipelineRunner,
  createHandlerRegistry,
} from "../../src/engine/runner.js";
import { saveCheckpoint } from "../../src/engine/checkpoint.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Checkpoint } from "../../src/types/checkpoint.js";
import type { Handler } from "../../src/types/handler.js";
import type { Graph, Node, Edge, AttributeValue } from "../../src/types/graph.js";
import { stringAttr, booleanAttr, integerAttr } from "../../src/types/graph.js";
import { join } from "path";
import { mkdtemp, rm, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "attractor-runner-resume-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Find the unique run subdirectory (pipelineId) created under logsRoot. */
async function findRunDir(logsRoot: string): Promise<string> {
  const entries = await readdir(logsRoot, { withFileTypes: true });
  const subdir = entries.find((e) => e.isDirectory());
  if (!subdir) return logsRoot;
  return join(logsRoot, subdir.name);
}

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

function stubHandler(outcome: ReturnType<typeof createOutcome>): Handler {
  return {
    execute: async () => outcome,
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

describe("PipelineRunner.resume", () => {
  test("restores context and skips completed nodes", async () => {
    const dir = await createTempDir();
    const checkpointPath = join(dir, "checkpoint.json");

    // Graph: start -> A -> B -> exit
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("A", { shape: stringAttr("box") }),
        makeNode("B", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "A"),
        makeEdge("A", "B"),
        makeEdge("B", "exit"),
      ],
      { goal: stringAttr("resume test") },
    );

    // Checkpoint after completing start and A
    const checkpoint: Checkpoint = {
      pipelineId: "resume-test-1",
      timestamp: new Date().toISOString(),
      currentNode: "A",
      completedNodes: ["start", "A"],
      nodeRetries: { start: 1, A: 1 },
      nodeOutcomes: { start: "success", A: "success" },
      contextValues: {
        "graph.goal": "resume test",
        outcome: "success",
        "my_key": "my_value",
      },
      logs: [],
    };
    await saveCheckpoint(checkpoint, checkpointPath);

    const records: string[] = [];
    const registry = createHandlerRegistry();
    registry.register("start", recordingHandler(records));
    registry.register("codergen", recordingHandler(records));
    registry.register("exit", recordingHandler(records));

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: dir,
    });

    const result = await runner.resume(graph, checkpointPath);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    // Should only execute B (skipping start and A)
    expect(records).toEqual(["B"]);
    // Context should carry forward restored values
    expect(result.context.get("my_key")).toBe("my_value");
    expect(result.context.get("graph.goal")).toBe("resume test");
    // completedNodes should include old ones plus B
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("A");
    expect(result.completedNodes).toContain("B");
  });

  test("sets degraded fidelity on first resumed node", async () => {
    const dir = await createTempDir();
    const checkpointPath = join(dir, "checkpoint.json");

    let capturedFidelity = "";
    const capturingHandler: Handler = {
      execute: async (_node, ctx) => {
        capturedFidelity = ctx.getString("_fidelity.mode", "");
        return createOutcome({ status: StageStatus.SUCCESS });
      },
    };

    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("A", { shape: stringAttr("box") }),
        makeNode("B", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "A"),
        makeEdge("A", "B"),
        makeEdge("B", "exit"),
      ],
    );

    const checkpoint: Checkpoint = {
      pipelineId: "resume-test-2",
      timestamp: new Date().toISOString(),
      currentNode: "A",
      completedNodes: ["start", "A"],
      nodeRetries: {},
      nodeOutcomes: { start: "success", A: "success" },
      contextValues: { outcome: "success", "_fidelity.mode": "full" },
      logs: [],
    };
    await saveCheckpoint(checkpoint, checkpointPath);

    const registry = createHandlerRegistry();
    registry.register("start", stubHandler(createOutcome({ status: StageStatus.SUCCESS })));
    registry.register("codergen", capturingHandler);
    registry.register("exit", stubHandler(createOutcome({ status: StageStatus.SUCCESS })));

    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: dir,
    });

    await runner.resume(graph, checkpointPath);

    expect(capturedFidelity).toBe("summary:high");
  });
});

describe("mid-pipeline failure routing to retry_target", () => {
  test("routes to retry_target when stage fails with no outgoing edges", async () => {
    let validateCallCount = 0;
    const records: string[] = [];
    const registry = createHandlerRegistry();
    registry.register("start", recordingHandler(records));
    registry.register("codergen", {
      execute: async (node) => {
        records.push(node.id);
        if (node.id === "validate") {
          validateCallCount++;
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

    // validate has retry_target=implement but no outgoing edges.
    // When validate fails, selectEdge returns undefined (0 outgoing edges).
    // GAP-2 kicks in: getRetryTarget finds "implement", routes there.
    // On second pass, validate succeeds; selectEdge returns undefined again,
    // but since outcome is SUCCESS, the loop breaks normally.
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("implement", { shape: stringAttr("box") }),
        makeNode("validate", {
          shape: stringAttr("box"),
          retry_target: stringAttr("implement"),
        }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "implement"),
        makeEdge("implement", "validate", { weight: integerAttr(10) }),
        makeEdge("implement", "exit"),
        // No outgoing edges from validate
      ],
    );

    const dir = await createTempDir();
    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: dir,
    });

    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.SUCCESS);
    expect(validateCallCount).toBe(2);
    expect(records.filter((r) => r === "implement")).toHaveLength(2);
  });

  test("terminates when no retry_target and no outgoing edges", async () => {
    const registry = createHandlerRegistry();
    registry.register("start", stubHandler(createOutcome({ status: StageStatus.SUCCESS })));
    registry.register("codergen", stubHandler(createOutcome({
      status: StageStatus.FAIL,
      failureReason: "permanent failure",
    })));

    // Dead-end: failing node has no outgoing edges, no retry_target
    const graph = makeGraph(
      [
        makeNode("start", { shape: stringAttr("Mdiamond") }),
        makeNode("failing", { shape: stringAttr("box") }),
        makeNode("exit", { shape: stringAttr("Msquare") }),
      ],
      [
        makeEdge("start", "failing", { weight: integerAttr(10) }),
        makeEdge("start", "exit"),
      ],
    );

    const dir = await createTempDir();
    const runner = new PipelineRunner({
      handlerRegistry: registry,
      logsRoot: dir,
    });

    const result = await runner.run(graph);

    expect(result.outcome.status).toBe(StageStatus.FAIL);
    expect(result.outcome.failureReason).toContain("no outgoing fail edge");
  });
});

describe("nodeRetries populated in checkpoint", () => {
  test("saves actual retry counts in checkpoint", async () => {
    const dir = await createTempDir();
    const registry = createHandlerRegistry();
    registry.register("start", stubHandler(createOutcome({ status: StageStatus.SUCCESS })));
    registry.register("exit", stubHandler(createOutcome({ status: StageStatus.SUCCESS })));
    registry.register("codergen", stubHandler(createOutcome({ status: StageStatus.SUCCESS })));

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
      logsRoot: dir,
    });

    await runner.run(graph);

    // Read the last checkpoint saved (under run-specific subdirectory)
    const runDir = await findRunDir(dir);
    const raw = await readFile(join(runDir, "checkpoint.json"), "utf-8");
    const checkpoint: Checkpoint = JSON.parse(raw) as Checkpoint;

    // Both start and work should have 1 attempt each (no retries)
    expect(checkpoint.nodeRetries["start"]).toBe(1);
    expect(checkpoint.nodeRetries["work"]).toBe(1);
  });
});
