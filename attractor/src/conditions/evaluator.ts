import type { Outcome } from "../types/outcome.js";
import type { Context } from "../types/context.js";

/**
 * Resolve a condition key to its string value.
 *
 * - "outcome" -> outcome.status
 * - "preferred_label" -> outcome.preferredLabel
 * - "context.foo" -> context.get("context.foo"), falling back to context.get("foo")
 * - bare key -> context.get(key)
 * - missing keys return ""
 */
export function resolveKey(
  key: string,
  outcome: Outcome,
  context: Context,
): string {
  if (key === "outcome") {
    return outcome.status;
  }
  if (key === "preferred_label") {
    return outcome.preferredLabel;
  }
  if (key.startsWith("context.")) {
    const fullValue = context.get(key);
    if (fullValue !== "") {
      return fullValue;
    }
    const stripped = key.slice("context.".length);
    return context.get(stripped);
  }
  return context.get(key);
}

/**
 * Evaluate a single clause: "key op literal" or bare key for truthiness.
 */
export function evaluateClause(
  clause: string,
  outcome: Outcome,
  context: Context,
): boolean {
  const trimmed = clause.trim();
  if (trimmed === "") {
    return true;
  }

  // Check != before = since "!=" contains "="
  const neqIndex = trimmed.indexOf("!=");
  if (neqIndex !== -1) {
    const key = trimmed.slice(0, neqIndex).trim();
    const value = trimmed.slice(neqIndex + 2).trim();
    return resolveKey(key, outcome, context) !== value;
  }

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex !== -1) {
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    return resolveKey(key, outcome, context) === value;
  }

  // Bare key: truthy check (non-empty string)
  const resolved = resolveKey(trimmed, outcome, context);
  return resolved !== "";
}

/**
 * Evaluate a full condition expression (clauses joined by &&).
 * Empty conditions always return true.
 */
export function evaluateCondition(
  condition: string,
  outcome: Outcome,
  context: Context,
): boolean {
  if (condition.trim() === "") {
    return true;
  }

  const clauses = condition.split("&&");
  return clauses.every((clause) => evaluateClause(clause, outcome, context));
}
