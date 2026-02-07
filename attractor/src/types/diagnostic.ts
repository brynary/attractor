export const Severity = {
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

export interface Diagnostic {
  rule: string;
  severity: Severity;
  message: string;
  nodeId: string;
  edge: [string, string] | undefined;
  fix: string;
}

export interface LintRule {
  name: string;
  apply(graph: import("./graph.js").Graph): Diagnostic[];
}

export function createDiagnostic(
  partial: Partial<Diagnostic> & { rule: string; severity: Severity; message: string },
): Diagnostic {
  return {
    nodeId: "",
    edge: undefined,
    fix: "",
    ...partial,
  };
}
