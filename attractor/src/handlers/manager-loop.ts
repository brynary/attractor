import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Handler } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import {
  getStringAttr,
  getIntegerAttr,
  getBooleanAttr,
  getDurationAttr,
} from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";
import { evaluateCondition } from "../conditions/evaluator.js";
import type { Checkpoint } from "../types/checkpoint.js";
import type { PipelineResult } from "../engine/runner.js";
import { PipelineRunner } from "../engine/runner.js";
import { parse } from "../parser/index.js";

export type ChildProcess = {
  childLogsRoot: string;
  waitForCompletion: () => Promise<{ exitCode: number }>;
  kill: () => void;
};

export type ChildProcessSpawner = (
  dotFile: string,
  logsRoot: string,
) => ChildProcess;

function defaultSpawner(dotFile: string, logsRoot: string): ChildProcess {
  const childLogsRoot = join(logsRoot, "child");
  mkdirSync(childLogsRoot, { recursive: true });

  const proc = Bun.spawn(["bun", "run", dotFile], {
    cwd: logsRoot,
    env: { ...process.env, ATTRACTOR_LOGS_ROOT: childLogsRoot },
    stdout: "ignore",
    stderr: "ignore",
  });

  return {
    childLogsRoot,
    waitForCompletion: async () => {
      const exitCode = await proc.exited;
      return { exitCode };
    },
    kill: () => {
      proc.kill();
    },
  };
}

export type PipelineRunnerFactory = (
  graph: Graph,
  logsRoot: string,
) => PipelineRunner;

function createInProcessSpawner(
  runnerFactory: PipelineRunnerFactory,
): ChildProcessSpawner {
  return (dotFile: string, logsRoot: string): ChildProcess => {
    const childLogsRoot = join(logsRoot, "child");
    mkdirSync(childLogsRoot, { recursive: true });

    const dotSource = readFileSync(dotFile, "utf-8");
    const graph = parse(dotSource);
    const runner = runnerFactory(graph, childLogsRoot);

    const runPromise = runner.run(graph).then((result: PipelineResult) => {
      // Write final checkpoint so the observe loop can pick it up
      const checkpoint: Checkpoint = {
        pipelineId: "sub-pipeline",
        timestamp: new Date().toISOString(),
        currentNode: result.completedNodes[result.completedNodes.length - 1] ?? "",
        completedNodes: result.completedNodes,
        nodeRetries: {},
        nodeOutcomes: {},
        contextValues: result.context.snapshot(),
        logs: [],
      };
      try {
        writeFileSync(
          join(childLogsRoot, "checkpoint.json"),
          JSON.stringify(checkpoint),
          "utf-8",
        );
      } catch {
        // non-fatal
      }
      return result.outcome.status === StageStatus.SUCCESS ? 0 : 1;
    });

    return {
      childLogsRoot,
      waitForCompletion: async () => {
        const exitCode = await runPromise;
        return { exitCode };
      },
      kill: () => {
        // In-process runner cannot be cancelled mid-execution
      },
    };
  };
}

export interface ManagerLoopHandlerConfig {
  spawner?: ChildProcessSpawner;
  runnerFactory?: PipelineRunnerFactory;
}

const DEFAULT_POLL_INTERVAL_MS = 45_000;
const DEFAULT_STEER_COOLDOWN_MS = 90_000; // 2 poll cycles at default interval

export class ManagerLoopHandler implements Handler {
  private readonly spawner: ChildProcessSpawner;

  constructor(config: ManagerLoopHandlerConfig = {}) {
    if (config.spawner) {
      this.spawner = config.spawner;
    } else if (config.runnerFactory) {
      this.spawner = createInProcessSpawner(config.runnerFactory);
    } else {
      this.spawner = defaultSpawner;
    }
  }

  async execute(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    // L5: Read stack.child_dotfile from graph attributes per spec
    const dotFile = getStringAttr(graph.attributes, "stack.child_dotfile");
    if (dotFile === "") {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: `Node ${node.id}: missing stack.child_dotfile attribute`,
      });
    }

    // L6: Parse poll_interval as a duration value
    const pollIntervalMs =
      getDurationAttr(node.attributes, "manager.poll_interval") ?? DEFAULT_POLL_INTERVAL_MS;
    const maxCycles = getIntegerAttr(
      node.attributes,
      "manager.max_cycles",
      1000,
    );
    const stopCondition = getStringAttr(
      node.attributes,
      "manager.stop_condition",
    );
    const actionsStr = getStringAttr(
      node.attributes,
      "manager.actions",
      "observe,wait",
    );
    const actions = actionsStr.split(",").map((a) => a.trim());

    // L7: Steer cooldown
    const steerCooldownMs =
      getDurationAttr(node.attributes, "manager.steer_cooldown") ?? DEFAULT_STEER_COOLDOWN_MS;
    let lastSteerTime = 0;

    // M7: Check child_autostart attribute (default true)
    const autostart = getBooleanAttr(node.attributes, "stack.child_autostart", true);

    // Start child subprocess only if autostart is true
    let child: ChildProcess | undefined;
    if (autostart) {
      child = this.spawner(dotFile, logsRoot);
    }

    if (!child) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: `Node ${node.id}: child not started (autostart disabled and no external child)`,
      });
    }

    let childCompleted = false;
    let childExitCode = -1;

    // Start waiting for completion in the background
    void child.waitForCompletion().then((result) => {
      childCompleted = true;
      childExitCode = result.exitCode;
      return result;
    });

    try {
      // Observation loop
      let cycle = 0;
      while (cycle < maxCycles) {
        cycle++;

        // observe: read child checkpoint
        if (actions.includes("observe")) {
          const checkpointPath = join(
            child.childLogsRoot,
            "checkpoint.json",
          );
          if (existsSync(checkpointPath)) {
            try {
              const raw = readFileSync(checkpointPath, "utf-8");
              const checkpoint: unknown = JSON.parse(raw);
              if (isCheckpointLike(checkpoint)) {
                // M8: Set status to "completed"/"failed" based on child state
                const childOutcomeValue = checkpoint.contextValues["outcome"];
                if (childCompleted || childOutcomeValue === "success" || childOutcomeValue === "fail") {
                  const isSuccess = childExitCode === 0 || childOutcomeValue === "success";
                  context.set(
                    "stack.child.status",
                    isSuccess ? "completed" : "failed",
                  );
                  context.set(
                    "stack.child.outcome",
                    isSuccess ? "success" : "fail",
                  );
                } else {
                  context.set("stack.child.status", "running");
                }

                context.set(
                  "stack.child.completedNodes",
                  checkpoint.completedNodes.join(","),
                );
                context.set(
                  "stack.child.currentNode",
                  checkpoint.currentNode,
                );

                // Ingest child context values
                for (const [key, value] of Object.entries(
                  checkpoint.contextValues,
                )) {
                  context.set(`stack.child.context.${key}`, value);
                }
              }
            } catch {
              // Checkpoint read/parse failure is non-fatal
            }
          }
        }

        // steer: write intervention file (with cooldown)
        if (actions.includes("steer")) {
          const now = Date.now();
          if (now - lastSteerTime >= steerCooldownMs) {
            lastSteerTime = now;
            const interventionDir = child.childLogsRoot;
            mkdirSync(interventionDir, { recursive: true });
            const interventionPath = join(
              interventionDir,
              "intervention.json",
            );
            const intervention = {
              timestamp: new Date().toISOString(),
              cycle,
              source: node.id,
            };
            writeFileSync(
              interventionPath,
              JSON.stringify(intervention, null, 2),
              "utf-8",
            );
          }
        }

        // Evaluate child status from context per spec
        const childStatus = context.getString("stack.child.status");
        if (childStatus === "completed" || childStatus === "failed") {
          const childOutcome = context.getString("stack.child.outcome");
          if (childOutcome === "success") {
            child.kill();
            return createOutcome({
              status: StageStatus.SUCCESS,
              contextUpdates: { last_stage: node.id },
              notes: `Manager ${node.id}: child completed successfully`,
            });
          }
          if (childStatus === "failed") {
            child.kill();
            return createOutcome({
              status: StageStatus.FAIL,
              failureReason: `Manager ${node.id}: child pipeline failed`,
            });
          }
        }

        // evaluate stop condition
        if (stopCondition !== "") {
          const dummyOutcome = createOutcome({
            status: StageStatus.SUCCESS,
          });
          if (evaluateCondition(stopCondition, dummyOutcome, context)) {
            child.kill();
            return createOutcome({
              status: StageStatus.SUCCESS,
              contextUpdates: { last_stage: node.id },
              notes: `Manager ${node.id}: stop condition met at cycle ${cycle}`,
            });
          }
        }

        // check if child completed or failed (process level)
        if (childCompleted) {
          if (childExitCode === 0) {
            return createOutcome({
              status: StageStatus.SUCCESS,
              contextUpdates: { last_stage: node.id },
              notes: `Manager ${node.id}: child completed successfully`,
            });
          }
          return createOutcome({
            status: StageStatus.FAIL,
            failureReason: `Manager ${node.id}: child exited with code ${String(childExitCode)}`,
          });
        }

        // wait
        if (actions.includes("wait")) {
          await new Promise((resolve) =>
            setTimeout(resolve, pollIntervalMs),
          );
        }
      }

      // max_cycles exceeded
      child.kill();
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: `Manager ${node.id}: max_cycles (${String(maxCycles)}) exceeded`,
      });
    } catch (err: unknown) {
      child.kill();
      const message = err instanceof Error ? err.message : String(err);
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: `Manager ${node.id}: unexpected error: ${message}`,
      });
    }
  }
}

function hasProp<K extends string>(obj: object, key: K): obj is Record<K, unknown> {
  return key in obj;
}

function isCheckpointLike(
  data: unknown,
): data is Checkpoint {
  if (typeof data !== "object" || data === null) return false;
  return (
    hasProp(data, "currentNode") &&
    typeof data.currentNode === "string" &&
    hasProp(data, "completedNodes") &&
    Array.isArray(data.completedNodes) &&
    hasProp(data, "contextValues") &&
    typeof data.contextValues === "object" &&
    data.contextValues !== null
  );
}
