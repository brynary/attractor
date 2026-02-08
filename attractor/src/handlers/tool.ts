import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Handler } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { getStringAttr, getDurationAttr } from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ToolHandler implements Handler {
  async execute(node: Node, _context: Context, _graph: Graph, logsRoot: string): Promise<Outcome> {
    const command = getStringAttr(node.attributes, "tool_command");
    if (command === "") {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No tool_command specified",
      });
    }

    const timeoutMs = getDurationAttr(node.attributes, "timeout") ?? DEFAULT_TIMEOUT_MS;

    try {
      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeoutId = setTimeout(() => {
        proc.kill();
      }, timeoutMs);

      try {
        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        const stageDir = join(logsRoot, node.id);
        mkdirSync(stageDir, { recursive: true });

        if (exitCode !== 0) {
          const failOutcome = createOutcome({
            status: StageStatus.FAIL,
            failureReason: "Command exited with code " + String(exitCode) + ": " + stderr,
          });
          await Bun.write(join(stageDir, "status.json"), JSON.stringify(failOutcome, null, 2));
          return failOutcome;
        }

        const outcome = createOutcome({
          status: StageStatus.SUCCESS,
          contextUpdates: { "tool.output": stdout },
          notes: "Tool completed: " + command,
        });
        await Bun.write(join(stageDir, "status.json"), JSON.stringify(outcome, null, 2));
        return outcome;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: message,
      });
    }
  }
}
