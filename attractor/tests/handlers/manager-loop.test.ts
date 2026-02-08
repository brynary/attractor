import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManagerLoopHandler } from "../../src/handlers/manager-loop.js";
import type {
  ChildProcessSpawner,
  ChildProcess,
} from "../../src/handlers/manager-loop.js";
import { StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import {
  stringAttr,
  integerAttr,
  durationAttr,
  booleanAttr,
} from "../../src/types/graph.js";
import type { Node, Graph, AttributeValue } from "../../src/types/graph.js";
import type { Checkpoint } from "../../src/types/checkpoint.js";

let tmpDir: string;

function makeNode(
  id: string,
  attrs: Record<string, AttributeValue> = {},
): Node {
  return { id, attributes: new Map(Object.entries(attrs)) };
}

function makeGraph(attrs: Record<string, AttributeValue> = {}): Graph {
  return {
    name: "parent",
    attributes: new Map(Object.entries(attrs)),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
  };
}

function writeCheckpoint(dir: string, checkpoint: Checkpoint): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "checkpoint.json"),
    JSON.stringify(checkpoint),
    "utf-8",
  );
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    pipelineId: "test-manager-loop",
    timestamp: new Date().toISOString(),
    currentNode: "work",
    completedNodes: ["start", "work"],
    nodeRetries: {},
    nodeOutcomes: {},
    contextValues: { outcome: "success" },
    logs: [],
    ...overrides,
  };
}

/**
 * Creates a stub spawner that resolves its waitForCompletion after the
 * specified number of poll cycles (observe calls). The checkpoint is
 * written to childLogsRoot before returning.
 */
function createStubSpawner(opts: {
  exitCode?: number;
  checkpoint?: Checkpoint;
  resolveImmediately?: boolean;
}): { spawner: ChildProcessSpawner; calls: Array<{ dotFile: string; logsRoot: string }>; killed: { value: boolean } } {
  const calls: Array<{ dotFile: string; logsRoot: string }> = [];
  const killed = { value: false };

  const spawner: ChildProcessSpawner = (
    dotFile: string,
    logsRoot: string,
  ): ChildProcess => {
    const childLogsRoot = join(logsRoot, "child");
    mkdirSync(childLogsRoot, { recursive: true });
    calls.push({ dotFile, logsRoot });

    // Write checkpoint if provided
    if (opts.checkpoint) {
      writeCheckpoint(childLogsRoot, opts.checkpoint);
    }

    const exitCode = opts.exitCode ?? 0;

    return {
      childLogsRoot,
      waitForCompletion: () => {
        if (opts.resolveImmediately) {
          return Promise.resolve({ exitCode });
        }
        // Never resolve by default (let the loop control flow)
        return new Promise(() => {});
      },
      kill: () => {
        killed.value = true;
      },
    };
  };

  return { spawner, calls, killed };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "manager-loop-test-"));
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("ManagerLoopHandler", () => {
  it("auto-starts child subprocess", async () => {
    const checkpoint = makeCheckpoint();
    const { spawner, calls } = createStubSpawner({
      exitCode: 0,
      checkpoint,
      resolveImmediately: true,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(2),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });

    await handler.execute(node, new Context(), graph, tmpDir);

    expect(calls.length).toBe(1);
    const firstCall = calls.at(0);
    expect(firstCall).toBeDefined();
    expect(firstCall?.dotFile).toBe("/path/to/child.dot");
  });

  it("does not start child when autostart is false", async () => {
    const { spawner, calls } = createStubSpawner({
      exitCode: 0,
      resolveImmediately: true,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "stack.child_autostart": booleanAttr(false),
      "manager.max_cycles": integerAttr(2),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });

    const outcome = await handler.execute(node, new Context(), graph, tmpDir);

    expect(calls.length).toBe(0);
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("autostart disabled");
  });

  it("observes child checkpoint data into context", async () => {
    const checkpoint = makeCheckpoint({
      currentNode: "step2",
      completedNodes: ["start", "step1", "step2"],
      contextValues: { outcome: "success", "custom.key": "custom-value" },
    });
    const { spawner } = createStubSpawner({
      exitCode: 0,
      checkpoint,
      resolveImmediately: true,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(2),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });
    const ctx = new Context();

    await handler.execute(node, ctx, graph, tmpDir);

    expect(ctx.get("stack.child.currentNode")).toBe("step2");
    expect(ctx.get("stack.child.completedNodes")).toBe("start,step1,step2");
    expect(ctx.get("stack.child.context.custom.key")).toBe("custom-value");
  });

  it("sets stack.child.status and stack.child.outcome on success", async () => {
    const checkpoint = makeCheckpoint({ contextValues: { outcome: "success" } });
    const { spawner } = createStubSpawner({
      exitCode: 0,
      checkpoint,
      resolveImmediately: true,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(3),
      "manager.poll_interval": durationAttr(0, "0ms"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(ctx.getString("stack.child.status")).toBe("completed");
    expect(ctx.getString("stack.child.outcome")).toBe("success");
  });

  it("returns FAIL when child fails", async () => {
    const checkpoint = makeCheckpoint({
      contextValues: { outcome: "fail" },
    });
    const { spawner } = createStubSpawner({
      checkpoint,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(2),
      "manager.poll_interval": durationAttr(0, "0ms"),
      "manager.actions": stringAttr("observe"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("child pipeline failed");
    expect(ctx.getString("stack.child.status")).toBe("failed");
    expect(ctx.getString("stack.child.outcome")).toBe("fail");
  });

  it("returns FAIL when max_cycles exceeded", async () => {
    // No checkpoint, child never completes
    const { spawner, killed } = createStubSpawner({});

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(3),
      "manager.poll_interval": durationAttr(0, "0ms"),
      "manager.actions": stringAttr("observe"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });

    const outcome = await handler.execute(
      node,
      new Context(),
      graph,
      tmpDir,
    );

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("max_cycles (3) exceeded");
    expect(killed.value).toBe(true);
  });

  it("evaluates stop condition and triggers early exit", async () => {
    // Checkpoint has in-progress outcome (not success/fail) but a custom
    // quality score that the stop condition checks
    const checkpoint = makeCheckpoint({
      contextValues: { outcome: "in_progress", "quality.score": "95" },
    });
    const { spawner, killed } = createStubSpawner({
      checkpoint,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(10),
      "manager.poll_interval": durationAttr(0, "0ms"),
      "manager.stop_condition": stringAttr(
        "stack.child.context.quality.score=95",
      ),
      "manager.actions": stringAttr("observe"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });

    const outcome = await handler.execute(
      node,
      new Context(),
      graph,
      tmpDir,
    );

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.notes).toContain("stop condition met");
    expect(killed.value).toBe(true);
  });

  it("writes intervention file when steer action is present", async () => {
    const checkpoint = makeCheckpoint({
      contextValues: { outcome: "fail" },
    });
    const { spawner } = createStubSpawner({
      checkpoint,
    });

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(2),
      "manager.poll_interval": durationAttr(0, "0ms"),
      "manager.steer_cooldown": durationAttr(0, "0ms"),
      "manager.actions": stringAttr("observe,steer"),
    });
    const graph = makeGraph({
      "stack.child_dotfile": stringAttr("/path/to/child.dot"),
    });

    await handler.execute(node, new Context(), graph, tmpDir);

    const interventionPath = join(tmpDir, "child", "intervention.json");
    expect(existsSync(interventionPath)).toBe(true);

    const intervention = JSON.parse(readFileSync(interventionPath, "utf-8"));
    expect(intervention.source).toBe("mgr");
    expect(intervention.cycle).toBe(1);
  });

  it("reads stack.child_dotfile from graph attributes", async () => {
    const checkpoint = makeCheckpoint({ contextValues: { outcome: "fail" } });
    const { spawner } = createStubSpawner({
      checkpoint,
    });

    const handler = new ManagerLoopHandler({ spawner });
    // dotfile on node should be ignored; graph attribute is used
    const node = makeNode("mgr", {
      "stack.child_dotfile": stringAttr("/wrong/path.dot"),
      "manager.max_cycles": integerAttr(1),
      "manager.poll_interval": durationAttr(0, "0ms"),
      "manager.actions": stringAttr("observe"),
    });
    // No dotfile in graph attributes => should fail
    const graph = makeGraph();

    const outcome = await handler.execute(
      node,
      new Context(),
      graph,
      tmpDir,
    );

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("missing stack.child_dotfile");
  });

  it("fails when stack.child_dotfile is missing from graph", async () => {
    const { spawner } = createStubSpawner({});

    const handler = new ManagerLoopHandler({ spawner });
    const node = makeNode("mgr", {
      "manager.max_cycles": integerAttr(1),
    });
    const graph = makeGraph();

    const outcome = await handler.execute(
      node,
      new Context(),
      graph,
      tmpDir,
    );

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("missing stack.child_dotfile");
  });
});
