import type { Graph } from "../types/graph.js";
import type { Transform } from "../types/transform.js";
import type { LintRule, Diagnostic } from "../types/diagnostic.js";
import { parse } from "../parser/index.js";
import { builtInTransforms } from "../transforms/index.js";
import { validateOrRaise } from "../validation/validate.js";

export { selectEdge, bestByWeightThenLexical } from "./edge-selection.js";
export { resolveFidelity, resolveThreadId, buildPreamble } from "./fidelity.js";
export type { FidelityResolution } from "./fidelity.js";
export { executeWithRetry, buildRetryPolicy } from "./retry.js";
export type { RetryResult, RetryCallbacks } from "./retry.js";
export { checkGoalGates, getRetryTarget } from "./goal-gates.js";
export type { GoalGateResult } from "./goal-gates.js";
export { saveCheckpoint, loadCheckpoint } from "./checkpoint.js";
export {
  PipelineRunner,
  createHandlerRegistry,
} from "./runner.js";
export type {
  HandlerRegistry,
  EventEmitter,
  PipelineRunnerConfig,
  PipelineResult,
} from "./runner.js";
export { executePreHook, executePostHook } from "./tool-hooks.js";

/**
 * Parse DOT source, apply built-in + custom transforms, and validate.
 * Returns the validated graph and any non-error diagnostics (warnings).
 * Throws ValidationError if the graph has error-severity diagnostics.
 */
export function preparePipeline(
  dotSource: string,
  transforms?: Transform[],
  extraLintRules?: LintRule[],
): { graph: Graph; diagnostics: Diagnostic[] } {
  let graph = parse(dotSource);

  const allTransforms = [...builtInTransforms(), ...(transforms ?? [])];
  for (const transform of allTransforms) {
    graph = transform.apply(graph);
  }

  const diagnostics = validateOrRaise(graph, extraLintRules);
  graph._transformsApplied = true;
  return { graph, diagnostics };
}
