import { describe, expect, test, afterEach } from "bun:test";
import { saveCheckpoint, loadCheckpoint } from "../../src/engine/checkpoint.js";
import type { Checkpoint } from "../../src/types/checkpoint.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "attractor-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("checkpoint save and load", () => {
  test("round-trips checkpoint data", async () => {
    const dir = await createTempDir();
    const path = join(dir, "checkpoint.json");

    const checkpoint: Checkpoint = {
      timestamp: "2025-01-01T00:00:00.000Z",
      currentNode: "implement",
      completedNodes: ["start", "plan", "implement"],
      nodeRetries: { implement: 2 },
      contextValues: { "graph.goal": "build feature", outcome: "success" },
      logs: ["Started", "Plan completed"],
    };

    await saveCheckpoint(checkpoint, path);
    const loaded = await loadCheckpoint(path);

    expect(loaded.timestamp).toBe(checkpoint.timestamp);
    expect(loaded.currentNode).toBe("implement");
    expect(loaded.completedNodes).toEqual(["start", "plan", "implement"]);
    expect(loaded.nodeRetries).toEqual({ implement: 2 });
    expect(loaded.contextValues).toEqual({
      "graph.goal": "build feature",
      outcome: "success",
    });
    expect(loaded.logs).toEqual(["Started", "Plan completed"]);
  });

  test("creates intermediate directories", async () => {
    const dir = await createTempDir();
    const path = join(dir, "nested", "deep", "checkpoint.json");

    const checkpoint: Checkpoint = {
      timestamp: "2025-01-01T00:00:00.000Z",
      currentNode: "start",
      completedNodes: ["start"],
      nodeRetries: {},
      contextValues: {},
      logs: [],
    };

    await saveCheckpoint(checkpoint, path);
    const loaded = await loadCheckpoint(path);

    expect(loaded.currentNode).toBe("start");
  });

  test("rejects invalid data", async () => {
    const dir = await createTempDir();
    const path = join(dir, "bad.json");
    const { writeFile } = await import("fs/promises");
    await writeFile(path, '{"not": "valid"}', "utf-8");

    expect(loadCheckpoint(path)).rejects.toThrow("Invalid checkpoint data");
  });
});
