import type { Node, Graph } from "./graph.js";
import type { Context } from "./context.js";
import type { Outcome } from "./outcome.js";

export interface Handler {
  execute(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome>;
}

export interface CodergenBackend {
  run(node: Node, prompt: string, context: Context): Promise<string | Outcome>;
}
