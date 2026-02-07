import type { Node } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import type { CodergenBackend } from "../types/handler.js";

export type StubResponseFn = (
  node: Node,
  prompt: string,
  context: Context,
) => string | Outcome;

/**
 * A stub backend for testing. Returns configurable responses per node ID,
 * or a fallback default response.
 */
export class StubBackend implements CodergenBackend {
  private responses: Map<string, string>;
  private responseFn: StubResponseFn | undefined;
  private defaultResponse: string;

  constructor(options?: {
    responses?: Map<string, string>;
    responseFn?: StubResponseFn;
    defaultResponse?: string;
  }) {
    this.responses = options?.responses ?? new Map();
    this.responseFn = options?.responseFn;
    this.defaultResponse = options?.defaultResponse ?? "stub response";
  }

  async run(
    node: Node,
    prompt: string,
    context: Context,
  ): Promise<string | Outcome> {
    if (this.responseFn) {
      return this.responseFn(node, prompt, context);
    }
    return this.responses.get(node.id) ?? this.defaultResponse;
  }
}
