import type { Handler } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { getStringAttr } from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

export class ToolHandler implements Handler {
  async execute(node: Node, _context: Context, _graph: Graph, _logsRoot: string): Promise<Outcome> {
    const command = getStringAttr(node.attributes, "tool_command");
    if (command === "") {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No tool_command specified",
      });
    }

    try {
      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        return createOutcome({
          status: StageStatus.FAIL,
          failureReason: "Command exited with code " + String(exitCode) + ": " + stderr,
        });
      }

      return createOutcome({
        status: StageStatus.SUCCESS,
        contextUpdates: { "tool.output": stdout },
        notes: "Tool completed: " + command,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: message,
      });
    }
  }
}
