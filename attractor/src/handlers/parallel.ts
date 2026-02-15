import type { Handler } from "../types/handler.js";
import type { Node, Graph, Edge, AttributeValue } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import type { EventEmitter } from "../engine/runner.js";
import type { PipelineEventKind, PipelineEventDataMap } from "../types/events.js";
import { outgoingEdges, getStringAttr, getIntegerAttr } from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";
import { JoinPolicy, ErrorPolicy, parseJoinPolicy, parseErrorPolicy } from "../types/parallel.js";
import { PipelineEventKind as EventKind } from "../types/events.js";

export type NodeExecutor = (
  nodeId: string,
  context: Context,
  graph: Graph,
  logsRoot: string,
) => Promise<Outcome>;

interface BranchResult {
  nodeId: string;
  outcome: Outcome;
}

function getFloatFromAttrs(attrs: Map<string, AttributeValue>, key: string, defaultValue: number): number {
  const attr = attrs.get(key);
  if (!attr) return defaultValue;
  if (attr.kind === "float") return attr.value;
  if (attr.kind === "integer") return attr.value;
  if (attr.kind === "string") {
    const n = parseFloat(attr.value);
    return isNaN(n) ? defaultValue : n;
  }
  return defaultValue;
}

class Semaphore {
  private running = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) next();
    } else {
      this.running--;
    }
  }
}

function resolveJoinK(joinPolicy: JoinPolicy, joinK: number, total: number): number {
  if (joinPolicy === JoinPolicy.QUORUM) {
    return Math.ceil(joinK * total);
  }
  return joinK;
}

export class ParallelHandler implements Handler {
  private readonly nodeExecutor: NodeExecutor;
  private readonly eventEmitter: EventEmitter | undefined;
  private readonly pipelineId: string;

  constructor(nodeExecutor: NodeExecutor, eventEmitter?: EventEmitter, pipelineId?: string) {
    this.nodeExecutor = nodeExecutor;
    this.eventEmitter = eventEmitter;
    this.pipelineId = pipelineId ?? "";
  }

  private emitEvent<K extends PipelineEventKind>(kind: K, data: PipelineEventDataMap[K]): void {
    if (!this.eventEmitter) return;
    this.eventEmitter.emit({
      kind,
      timestamp: new Date(),
      pipelineId: this.pipelineId,
      data,
    });
  }

  async execute(node: Node, context: Context, graph: Graph, logsRoot: string): Promise<Outcome> {
    const branches = outgoingEdges(graph, node.id);

    if (branches.length === 0) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No outgoing edges for parallel node",
      });
    }

    this.emitEvent(EventKind.PARALLEL_STARTED, { branchCount: branches.length });

    const joinPolicy = parseJoinPolicy(getStringAttr(node.attributes, "join_policy", JoinPolicy.WAIT_ALL));
    const errorPolicy = parseErrorPolicy(getStringAttr(node.attributes, "error_policy", ErrorPolicy.CONTINUE));
    const maxParallel = getIntegerAttr(node.attributes, "max_parallel", 4);
    const joinK = getFloatFromAttrs(node.attributes, "join_k", 1);
    const requiredSuccesses = resolveJoinK(joinPolicy, joinK, branches.length);

    const semaphore = new Semaphore(maxParallel);
    const results: BranchResult[] = [];
    let aborted = false;
    let successCount = 0;
    let failCount = 0;

    if (joinPolicy === JoinPolicy.FIRST_SUCCESS) {
      return this.executeFirstSuccess(branches, context, graph, logsRoot, semaphore);
    }

    if (joinPolicy === JoinPolicy.K_OF_N || joinPolicy === JoinPolicy.QUORUM) {
      return this.executeKOfN(branches, context, graph, logsRoot, semaphore, requiredSuccesses);
    }

    // wait_all with optional fail_fast / ignore
    const promises = branches.map(async (branch) => {
      if (aborted) {
        results.push({
          nodeId: branch.to,
          outcome: createOutcome({ status: StageStatus.SKIPPED, notes: "Aborted due to fail_fast" }),
        });
        return;
      }

      await semaphore.acquire();
      if (aborted) {
        semaphore.release();
        results.push({
          nodeId: branch.to,
          outcome: createOutcome({ status: StageStatus.SKIPPED, notes: "Aborted due to fail_fast" }),
        });
        return;
      }

      try {
        this.emitEvent(EventKind.PARALLEL_BRANCH_STARTED, { branch: branch.to });
        const branchContext = context.clone();
        const outcome = await this.nodeExecutor(branch.to, branchContext, graph, logsRoot);

        const branchSuccess = outcome.status !== StageStatus.FAIL;
        if (!branchSuccess) {
          failCount++;
          if (errorPolicy === ErrorPolicy.FAIL_FAST) {
            aborted = true;
          }
        } else {
          successCount++;
        }

        results.push({ nodeId: branch.to, outcome });
        this.emitEvent(EventKind.PARALLEL_BRANCH_COMPLETED, { branch: branch.to, success: branchSuccess });
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);

    this.storeResults(results, context);

    const completedData = { successCount, failureCount: failCount };

    if (errorPolicy === ErrorPolicy.IGNORE) {
      this.emitEvent(EventKind.PARALLEL_COMPLETED, completedData);
      return createOutcome({
        status: StageStatus.SUCCESS,
        notes: "All " + String(results.length) + " branches completed (errors ignored)",
      });
    }

    if (failCount === 0) {
      this.emitEvent(EventKind.PARALLEL_COMPLETED, completedData);
      return createOutcome({
        status: StageStatus.SUCCESS,
        notes: "All " + String(successCount) + " branches completed successfully",
      });
    }

    if (errorPolicy === ErrorPolicy.FAIL_FAST) {
      this.emitEvent(EventKind.PARALLEL_COMPLETED, completedData);
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "Branch failed with fail_fast policy",
        notes: String(successCount) + " of " + String(branches.length) + " branches succeeded before failure",
      });
    }

    this.emitEvent(EventKind.PARALLEL_COMPLETED, completedData);
    return createOutcome({
      status: StageStatus.PARTIAL_SUCCESS,
      notes: String(successCount) + " of " + String(results.length) + " branches succeeded",
    });
  }

  private async executeFirstSuccess(
    branches: Edge[],
    context: Context,
    graph: Graph,
    logsRoot: string,
    semaphore: Semaphore,
  ): Promise<Outcome> {
    const results: BranchResult[] = [];
    let resolved = false;

    return new Promise<Outcome>((resolve) => {
      let completedCount = 0;

      const tryResolve = () => {
        if (resolved) return;

        const successResult = results.find((r) => r.outcome.status === StageStatus.SUCCESS);
        if (successResult) {
          resolved = true;
          // Mark remaining as cancelled
          const finishedIds = new Set(results.map((r) => r.nodeId));
          branches
            .filter((b) => !finishedIds.has(b.to))
            .forEach((b) => {
              results.push({
                nodeId: b.to,
                outcome: createOutcome({ status: StageStatus.SKIPPED, notes: "Cancelled: first_success resolved" }),
              });
            });
          this.storeResults(results, context);
          this.emitEvent(EventKind.PARALLEL_COMPLETED, { successCount: 1, failureCount: completedCount - 1 });
          resolve(createOutcome({
            status: StageStatus.SUCCESS,
            notes: "First success from branch " + successResult.nodeId,
          }));
          return;
        }

        if (completedCount === branches.length) {
          resolved = true;
          this.storeResults(results, context);
          this.emitEvent(EventKind.PARALLEL_COMPLETED, { successCount: 0, failureCount: completedCount });
          resolve(createOutcome({
            status: StageStatus.FAIL,
            failureReason: "No branch succeeded",
            notes: "All " + String(branches.length) + " branches failed",
          }));
        }
      };

      branches.forEach((branch) => {
        if (resolved) {
          results.push({
            nodeId: branch.to,
            outcome: createOutcome({ status: StageStatus.SKIPPED, notes: "Cancelled: first_success resolved" }),
          });
          completedCount++;
          tryResolve();
          return;
        }

        const run = async () => {
          await semaphore.acquire();
          if (resolved) {
            semaphore.release();
            results.push({
              nodeId: branch.to,
              outcome: createOutcome({ status: StageStatus.SKIPPED, notes: "Cancelled: first_success resolved" }),
            });
            completedCount++;
            tryResolve();
            return;
          }

          try {
            this.emitEvent(EventKind.PARALLEL_BRANCH_STARTED, { branch: branch.to });
            const branchContext = context.clone();
            const outcome = await this.nodeExecutor(branch.to, branchContext, graph, logsRoot);
            results.push({ nodeId: branch.to, outcome });
            this.emitEvent(EventKind.PARALLEL_BRANCH_COMPLETED, { branch: branch.to, success: outcome.status !== StageStatus.FAIL });
          } catch {
            results.push({
              nodeId: branch.to,
              outcome: createOutcome({ status: StageStatus.FAIL, failureReason: "Branch threw" }),
            });
            this.emitEvent(EventKind.PARALLEL_BRANCH_COMPLETED, { branch: branch.to, success: false });
          } finally {
            semaphore.release();
            completedCount++;
            tryResolve();
          }
        };

        void run();
      });
    });
  }

  private async executeKOfN(
    branches: Edge[],
    context: Context,
    graph: Graph,
    logsRoot: string,
    semaphore: Semaphore,
    requiredSuccesses: number,
  ): Promise<Outcome> {
    const results: BranchResult[] = [];
    let resolved = false;
    let successCount = 0;

    return new Promise<Outcome>((resolve) => {
      let completedCount = 0;

      const tryResolve = () => {
        if (resolved) return;

        if (successCount >= requiredSuccesses) {
          resolved = true;
          this.storeResults(results, context);
          this.emitEvent(EventKind.PARALLEL_COMPLETED, { successCount, failureCount: completedCount - successCount });
          resolve(createOutcome({
            status: StageStatus.SUCCESS,
            notes: String(successCount) + " of " + String(branches.length) + " branches succeeded (required: " + String(requiredSuccesses) + ")",
          }));
          return;
        }

        const remaining = branches.length - completedCount;
        if (remaining + successCount < requiredSuccesses) {
          resolved = true;
          this.storeResults(results, context);
          this.emitEvent(EventKind.PARALLEL_COMPLETED, { successCount, failureCount: completedCount - successCount });
          resolve(createOutcome({
            status: StageStatus.FAIL,
            failureReason: "Cannot reach " + String(requiredSuccesses) + " successes: " + String(successCount) + " succeeded, " + String(remaining) + " remaining",
            notes: String(successCount) + " of " + String(branches.length) + " branches succeeded",
          }));
          return;
        }

        if (completedCount === branches.length) {
          resolved = true;
          this.storeResults(results, context);
          this.emitEvent(EventKind.PARALLEL_COMPLETED, { successCount, failureCount: completedCount - successCount });
          // All done but we didn't reach the threshold
          resolve(createOutcome({
            status: StageStatus.FAIL,
            failureReason: "Only " + String(successCount) + " successes, required " + String(requiredSuccesses),
          }));
        }
      };

      branches.forEach((branch) => {
        const run = async () => {
          await semaphore.acquire();
          if (resolved) {
            semaphore.release();
            results.push({
              nodeId: branch.to,
              outcome: createOutcome({ status: StageStatus.SKIPPED, notes: "Cancelled: k_of_n resolved" }),
            });
            completedCount++;
            return;
          }

          try {
            this.emitEvent(EventKind.PARALLEL_BRANCH_STARTED, { branch: branch.to });
            const branchContext = context.clone();
            const outcome = await this.nodeExecutor(branch.to, branchContext, graph, logsRoot);
            results.push({ nodeId: branch.to, outcome });
            const branchSuccess = outcome.status !== StageStatus.FAIL;
            if (branchSuccess) {
              successCount++;
            }
            this.emitEvent(EventKind.PARALLEL_BRANCH_COMPLETED, { branch: branch.to, success: branchSuccess });
          } catch {
            results.push({
              nodeId: branch.to,
              outcome: createOutcome({ status: StageStatus.FAIL, failureReason: "Branch threw" }),
            });
            this.emitEvent(EventKind.PARALLEL_BRANCH_COMPLETED, { branch: branch.to, success: false });
          } finally {
            semaphore.release();
            completedCount++;
            tryResolve();
          }
        };

        void run();
      });
    });
  }

  private storeResults(results: BranchResult[], context: Context): void {
    const serialized = results.map((r) => {
      const scoreVal = r.outcome.contextUpdates["score"];
      const score = typeof scoreVal === "number" ? scoreVal : 0;
      return {
        nodeId: r.nodeId,
        status: r.outcome.status,
        notes: r.outcome.notes,
        score,
        contextUpdates: r.outcome.contextUpdates,
      };
    });
    context.set("parallel.results", JSON.stringify(serialized));
  }
}
