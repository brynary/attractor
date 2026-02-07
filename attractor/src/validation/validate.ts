import type { Graph } from "../types/graph.js";
import type { Diagnostic, LintRule } from "../types/diagnostic.js";
import { Severity } from "../types/diagnostic.js";
import { BUILT_IN_RULES } from "./rules.js";

export class ValidationError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const messages = diagnostics.map((d) => `[${d.rule}] ${d.message}`);
    super(`Validation failed:\n${messages.join("\n")}`);
    this.name = "ValidationError";
    this.diagnostics = diagnostics;
  }
}

export function validate(
  graph: Graph,
  extraRules: readonly LintRule[] = [],
): Diagnostic[] {
  const rules = [...BUILT_IN_RULES, ...extraRules];
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.apply(graph));
  }
  return diagnostics;
}

export function validateOrRaise(
  graph: Graph,
  extraRules: readonly LintRule[] = [],
): Diagnostic[] {
  const diagnostics = validate(graph, extraRules);
  const errors = diagnostics.filter((d) => d.severity === Severity.ERROR);
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
  return diagnostics;
}
