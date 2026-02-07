import type { Handler } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

export class ManagerLoopHandler implements Handler {
  async execute(node: Node, _context: Context, _graph: Graph, _logsRoot: string): Promise<Outcome> {
    return createOutcome({
      status: StageStatus.SUCCESS,
      notes: "Manager loop skeleton: " + node.id + " (full implementation deferred)",
    });
  }
}
