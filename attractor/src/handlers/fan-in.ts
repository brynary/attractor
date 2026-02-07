import type { Handler } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

interface ParallelResult {
  nodeId: string;
  status: string;
  notes: string;
  contextUpdates: Record<string, string>;
}

const OUTCOME_RANK: Record<string, number> = {
  [StageStatus.SUCCESS]: 0,
  [StageStatus.PARTIAL_SUCCESS]: 1,
  [StageStatus.RETRY]: 2,
  [StageStatus.FAIL]: 3,
};

function heuristicSelect(candidates: readonly ParallelResult[]): ParallelResult | undefined {
  if (candidates.length === 0) return undefined;

  const sorted = [...candidates].sort((a, b) => {
    const rankA = OUTCOME_RANK[a.status] ?? 4;
    const rankB = OUTCOME_RANK[b.status] ?? 4;
    if (rankA !== rankB) return rankA - rankB;
    return a.nodeId.localeCompare(b.nodeId);
  });

  return sorted[0];
}

export class FanInHandler implements Handler {
  async execute(node: Node, context: Context, _graph: Graph, _logsRoot: string): Promise<Outcome> {
    // 1. Read parallel results
    const raw = context.get("parallel.results");
    if (raw === "") {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No parallel results to evaluate",
      });
    }

    let results: ParallelResult[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return createOutcome({
          status: StageStatus.FAIL,
          failureReason: "Parallel results is not an array",
        });
      }
      results = parsed as ParallelResult[];
    } catch {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "Failed to parse parallel results",
      });
    }

    // 2. Check if all failed
    const allFailed = results.every((r) => r.status === StageStatus.FAIL);
    if (allFailed) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "All parallel candidates failed",
        notes: "Fan-in node: " + node.id,
      });
    }

    // 3. Heuristic selection
    const best = heuristicSelect(results);
    if (!best) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No candidates available",
      });
    }

    return createOutcome({
      status: StageStatus.SUCCESS,
      contextUpdates: {
        "parallel.fan_in.best_id": best.nodeId,
        "parallel.fan_in.best_outcome": best.status,
      },
      notes: "Selected best candidate: " + best.nodeId,
    });
  }
}
