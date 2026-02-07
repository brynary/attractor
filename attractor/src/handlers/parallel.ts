import type { Handler } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { outgoingEdges } from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

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

export class ParallelHandler implements Handler {
  private readonly nodeExecutor: NodeExecutor;

  constructor(nodeExecutor: NodeExecutor) {
    this.nodeExecutor = nodeExecutor;
  }

  async execute(node: Node, context: Context, graph: Graph, logsRoot: string): Promise<Outcome> {
    // 1. Get outgoing edges as branches
    const branches = outgoingEdges(graph, node.id);

    if (branches.length === 0) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No outgoing edges for parallel node",
      });
    }

    // 2. Execute branches sequentially (v1 simplified - bounded parallelism deferred)
    const results: BranchResult[] = [];
    for (const branch of branches) {
      const branchContext = context.clone();
      const outcome = await this.nodeExecutor(branch.to, branchContext, graph, logsRoot);
      results.push({ nodeId: branch.to, outcome });
    }

    // 3. Evaluate join policy (v1: wait_all only)
    const failCount = results.filter((r) => r.outcome.status === StageStatus.FAIL).length;

    // 4. Store results in context for downstream fan-in
    const serialized = results.map((r) => ({
      nodeId: r.nodeId,
      status: r.outcome.status,
      notes: r.outcome.notes,
      contextUpdates: r.outcome.contextUpdates,
    }));
    context.set("parallel.results", JSON.stringify(serialized));

    if (failCount === 0) {
      return createOutcome({
        status: StageStatus.SUCCESS,
        notes: "All " + String(results.length) + " branches completed successfully",
      });
    }

    return createOutcome({
      status: StageStatus.PARTIAL_SUCCESS,
      notes:
        String(results.length - failCount) +
        " of " +
        String(results.length) +
        " branches succeeded",
    });
  }
}
