import type { Graph, Node } from "../types/graph.js";
import {
  getStringAttr,
  getBooleanAttr,
  outgoingEdges,
  incomingEdges,
} from "../types/graph.js";
import type { Diagnostic, LintRule } from "../types/diagnostic.js";
import { Severity, createDiagnostic } from "../types/diagnostic.js";
import { isValidFidelityMode } from "../types/fidelity.js";

// -- Shape / type constants --

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
};

const KNOWN_TYPES = new Set(Object.values(SHAPE_TO_TYPE));

function resolveType(node: Node): string {
  const explicit = getStringAttr(node.attributes, "type");
  if (explicit !== "") return explicit;
  const shape = getStringAttr(node.attributes, "shape");
  return SHAPE_TO_TYPE[shape] ?? "codergen";
}

function findStartNode(graph: Graph): Node | undefined {
  for (const node of graph.nodes.values()) {
    if (resolveType(node) === "start") return node;
  }
  return undefined;
}

function findTerminalNodes(graph: Graph): Node[] {
  const result: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (resolveType(node) === "exit") result.push(node);
  }
  return result;
}

// -- Rules --

const startNodeRule: LintRule = {
  name: "start_node",
  apply(graph: Graph): Diagnostic[] {
    let count = 0;
    for (const node of graph.nodes.values()) {
      if (resolveType(node) === "start") count++;
    }
    if (count === 0) {
      return [
        createDiagnostic({
          rule: "start_node",
          severity: Severity.ERROR,
          message: "Pipeline must have exactly one start node (shape=Mdiamond).",
          fix: 'Add a node with shape=Mdiamond, e.g.: start [shape=Mdiamond]',
        }),
      ];
    }
    if (count > 1) {
      return [
        createDiagnostic({
          rule: "start_node",
          severity: Severity.ERROR,
          message: `Pipeline must have exactly one start node, found ${count}.`,
          fix: "Remove duplicate start nodes.",
        }),
      ];
    }
    return [];
  },
};

const terminalNodeRule: LintRule = {
  name: "terminal_node",
  apply(graph: Graph): Diagnostic[] {
    const terminals = findTerminalNodes(graph);
    if (terminals.length === 0) {
      return [
        createDiagnostic({
          rule: "terminal_node",
          severity: Severity.ERROR,
          message: "Pipeline must have at least one terminal node (shape=Msquare).",
          fix: 'Add a node with shape=Msquare, e.g.: done [shape=Msquare]',
        }),
      ];
    }
    return [];
  },
};

const reachabilityRule: LintRule = {
  name: "reachability",
  apply(graph: Graph): Diagnostic[] {
    const start = findStartNode(graph);
    if (!start) return []; // start_node rule covers this

    const visited = new Set<string>();
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of outgoingEdges(graph, current)) {
        if (!visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }

    const diagnostics: Diagnostic[] = [];
    for (const node of graph.nodes.values()) {
      if (!visited.has(node.id)) {
        diagnostics.push(
          createDiagnostic({
            rule: "reachability",
            severity: Severity.ERROR,
            message: `Node "${node.id}" is not reachable from the start node.`,
            nodeId: node.id,
            fix: "Add an edge from a reachable node or remove this node.",
          }),
        );
      }
    }
    return diagnostics;
  },
};

const edgeTargetExistsRule: LintRule = {
  name: "edge_target_exists",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const edge of graph.edges) {
      if (!graph.nodes.has(edge.from)) {
        diagnostics.push(
          createDiagnostic({
            rule: "edge_target_exists",
            severity: Severity.ERROR,
            message: `Edge source "${edge.from}" does not reference an existing node.`,
            edge: [edge.from, edge.to],
            fix: `Add a node with id "${edge.from}".`,
          }),
        );
      }
      if (!graph.nodes.has(edge.to)) {
        diagnostics.push(
          createDiagnostic({
            rule: "edge_target_exists",
            severity: Severity.ERROR,
            message: `Edge target "${edge.to}" does not reference an existing node.`,
            edge: [edge.from, edge.to],
            fix: `Add a node with id "${edge.to}".`,
          }),
        );
      }
    }
    return diagnostics;
  },
};

const startNoIncomingRule: LintRule = {
  name: "start_no_incoming",
  apply(graph: Graph): Diagnostic[] {
    const start = findStartNode(graph);
    if (!start) return [];
    const incoming = incomingEdges(graph, start.id);
    if (incoming.length > 0) {
      return [
        createDiagnostic({
          rule: "start_no_incoming",
          severity: Severity.ERROR,
          message: `Start node "${start.id}" must have no incoming edges, found ${incoming.length}.`,
          nodeId: start.id,
          fix: "Remove incoming edges to the start node.",
        }),
      ];
    }
    return [];
  },
};

const exitNoOutgoingRule: LintRule = {
  name: "exit_no_outgoing",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of findTerminalNodes(graph)) {
      const outgoing = outgoingEdges(graph, node.id);
      if (outgoing.length > 0) {
        diagnostics.push(
          createDiagnostic({
            rule: "exit_no_outgoing",
            severity: Severity.ERROR,
            message: `Exit node "${node.id}" must have no outgoing edges, found ${outgoing.length}.`,
            nodeId: node.id,
            fix: "Remove outgoing edges from the exit node.",
          }),
        );
      }
    }
    return diagnostics;
  },
};

/**
 * Validate condition syntax: each clause must be "key op value" or bare key.
 * Operators: = and !=.
 */
function isValidCondition(condition: string): boolean {
  if (condition.trim() === "") return true;
  const clauses = condition.split("&&");
  return clauses.every((clause) => {
    const trimmed = clause.trim();
    if (trimmed === "") return true;
    // Has an operator
    if (trimmed.includes("!=") || trimmed.includes("=")) {
      const opIndex = trimmed.indexOf("!=");
      if (opIndex !== -1) {
        const key = trimmed.slice(0, opIndex).trim();
        return key.length > 0;
      }
      const eqIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIndex).trim();
      return key.length > 0;
    }
    // Bare key: must be non-empty identifier-like
    return trimmed.length > 0;
  });
}

const conditionSyntaxRule: LintRule = {
  name: "condition_syntax",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const edge of graph.edges) {
      const condition = getStringAttr(edge.attributes, "condition");
      if (condition !== "" && !isValidCondition(condition)) {
        diagnostics.push(
          createDiagnostic({
            rule: "condition_syntax",
            severity: Severity.ERROR,
            message: `Edge condition "${condition}" has invalid syntax.`,
            edge: [edge.from, edge.to],
            fix: 'Use format: "key=value" or "key!=value", joined by "&&".',
          }),
        );
      }
    }
    return diagnostics;
  },
};

/**
 * Basic stylesheet syntax check: balanced braces.
 * A full parser may provide deeper validation later.
 */
function hasBalancedBraces(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const stylesheetSyntaxRule: LintRule = {
  name: "stylesheet_syntax",
  apply(graph: Graph): Diagnostic[] {
    const stylesheet = getStringAttr(graph.attributes, "model_stylesheet");
    if (stylesheet === "") return [];
    if (!hasBalancedBraces(stylesheet)) {
      return [
        createDiagnostic({
          rule: "stylesheet_syntax",
          severity: Severity.ERROR,
          message: "model_stylesheet has unbalanced braces.",
          fix: "Ensure all { have matching }.",
        }),
      ];
    }
    return [];
  },
};

const typeKnownRule: LintRule = {
  name: "type_known",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of graph.nodes.values()) {
      const explicit = getStringAttr(node.attributes, "type");
      if (explicit !== "" && !KNOWN_TYPES.has(explicit)) {
        diagnostics.push(
          createDiagnostic({
            rule: "type_known",
            severity: Severity.WARNING,
            message: `Node "${node.id}" has unrecognized type "${explicit}".`,
            nodeId: node.id,
            fix: `Use one of: ${[...KNOWN_TYPES].join(", ")}.`,
          }),
        );
      }
    }
    return diagnostics;
  },
};

const fidelityValidRule: LintRule = {
  name: "fidelity_valid",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of graph.nodes.values()) {
      const fidelity = getStringAttr(node.attributes, "fidelity");
      if (fidelity !== "" && !isValidFidelityMode(fidelity)) {
        diagnostics.push(
          createDiagnostic({
            rule: "fidelity_valid",
            severity: Severity.WARNING,
            message: `Node "${node.id}" has invalid fidelity mode "${fidelity}".`,
            nodeId: node.id,
            fix: "Use one of: full, truncate, compact, summary:low, summary:medium, summary:high.",
          }),
        );
      }
    }
    return diagnostics;
  },
};

const retryTargetExistsRule: LintRule = {
  name: "retry_target_exists",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of graph.nodes.values()) {
      const retryTarget = getStringAttr(node.attributes, "retry_target");
      if (retryTarget !== "" && !graph.nodes.has(retryTarget)) {
        diagnostics.push(
          createDiagnostic({
            rule: "retry_target_exists",
            severity: Severity.WARNING,
            message: `Node "${node.id}" retry_target "${retryTarget}" does not reference an existing node.`,
            nodeId: node.id,
            fix: `Add a node with id "${retryTarget}" or fix the retry_target value.`,
          }),
        );
      }
      const fallback = getStringAttr(node.attributes, "fallback_retry_target");
      if (fallback !== "" && !graph.nodes.has(fallback)) {
        diagnostics.push(
          createDiagnostic({
            rule: "retry_target_exists",
            severity: Severity.WARNING,
            message: `Node "${node.id}" fallback_retry_target "${fallback}" does not reference an existing node.`,
            nodeId: node.id,
            fix: `Add a node with id "${fallback}" or fix the fallback_retry_target value.`,
          }),
        );
      }
    }
    return diagnostics;
  },
};

const goalGateHasRetryRule: LintRule = {
  name: "goal_gate_has_retry",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of graph.nodes.values()) {
      if (getBooleanAttr(node.attributes, "goal_gate")) {
        const retryTarget = getStringAttr(node.attributes, "retry_target");
        const fallback = getStringAttr(node.attributes, "fallback_retry_target");
        if (retryTarget === "" && fallback === "") {
          diagnostics.push(
            createDiagnostic({
              rule: "goal_gate_has_retry",
              severity: Severity.WARNING,
              message: `Node "${node.id}" has goal_gate=true but no retry_target or fallback_retry_target.`,
              nodeId: node.id,
              fix: "Add a retry_target or fallback_retry_target attribute.",
            }),
          );
        }
      }
    }
    return diagnostics;
  },
};

const promptOnLlmNodesRule: LintRule = {
  name: "prompt_on_llm_nodes",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of graph.nodes.values()) {
      if (resolveType(node) === "codergen") {
        const prompt = getStringAttr(node.attributes, "prompt");
        const label = getStringAttr(node.attributes, "label");
        if (prompt === "" && label === "") {
          diagnostics.push(
            createDiagnostic({
              rule: "prompt_on_llm_nodes",
              severity: Severity.WARNING,
              message: `Codergen node "${node.id}" has no prompt or label attribute.`,
              nodeId: node.id,
              fix: "Add a prompt or label attribute to describe the LLM task.",
            }),
          );
        }
      }
    }
    return diagnostics;
  },
};

export const BUILT_IN_RULES: readonly LintRule[] = [
  startNodeRule,
  terminalNodeRule,
  reachabilityRule,
  edgeTargetExistsRule,
  startNoIncomingRule,
  exitNoOutgoingRule,
  conditionSyntaxRule,
  stylesheetSyntaxRule,
  typeKnownRule,
  fidelityValidRule,
  retryTargetExistsRule,
  goalGateHasRetryRule,
  promptOnLlmNodesRule,
];
