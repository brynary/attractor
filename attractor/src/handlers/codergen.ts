import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Handler, CodergenBackend, BackendRunOptions } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { getStringAttr } from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

function expandVariables(prompt: string, graph: Graph, _context: Context): string {
  const goal = getStringAttr(graph.attributes, "goal");
  return prompt.replace(/\$goal/g, goal);
}

export class CodergenHandler implements Handler {
  private readonly backend: CodergenBackend | undefined;

  constructor(backend?: CodergenBackend) {
    this.backend = backend;
  }

  async execute(node: Node, context: Context, graph: Graph, logsRoot: string): Promise<Outcome> {
    // 1. Build prompt
    let prompt = getStringAttr(node.attributes, "prompt");
    if (prompt === "") {
      prompt = getStringAttr(node.attributes, "label", node.id);
    }
    prompt = expandVariables(prompt, graph, context);

    // 2. Create stage directory and write prompt
    const stageDir = join(logsRoot, node.id);
    mkdirSync(stageDir, { recursive: true });
    await Bun.write(join(stageDir, "prompt.md"), prompt);

    // 3. Call LLM backend
    let responseText: string;

    if (this.backend) {
      try {
        const preToolHook = getStringAttr(node.attributes, "tool_hooks.pre")
        || getStringAttr(graph.attributes, "tool_hooks.pre")
        || undefined;
      const postToolHook = getStringAttr(node.attributes, "tool_hooks.post")
        || getStringAttr(graph.attributes, "tool_hooks.post")
        || undefined;
      const options: BackendRunOptions = { logsRoot, preToolHook, postToolHook };
        const result = await this.backend.run(node, prompt, context, options);
        if (typeof result !== "string") {
          // result is an Outcome
          await Bun.write(join(stageDir, "status.json"), JSON.stringify(result, null, 2));
          return result;
        }
        responseText = result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const failOutcome = createOutcome({
          status: StageStatus.FAIL,
          failureReason: message,
        });
        await Bun.write(join(stageDir, "status.json"), JSON.stringify(failOutcome, null, 2));
        return failOutcome;
      }
    } else {
      responseText = "[Simulated] Response for stage: " + node.id;
    }

    // 4. Write response
    await Bun.write(join(stageDir, "response.md"), responseText);

    // 5. Build and write outcome
    const outcome = createOutcome({
      status: StageStatus.SUCCESS,
      notes: "Stage completed: " + node.id,
      contextUpdates: {
        last_stage: node.id,
        last_response: responseText.slice(0, 200),
      },
    });
    await Bun.write(join(stageDir, "status.json"), JSON.stringify(outcome, null, 2));

    return outcome;
  }
}
