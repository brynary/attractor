import { TokenKind, type Token } from "./tokens.js";
import type { Graph, Node, Edge, AttributeValue } from "../types/index.js";
import {
  stringAttr,
  integerAttr,
  floatAttr,
  booleanAttr,
  durationAttr,
} from "../types/index.js";
import { parseDuration, isDurationString } from "../utils/duration.js";
import { deriveClassName } from "../utils/label.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = "ParseError";
  }
}

interface Scope {
  nodeDefaults: Map<string, AttributeValue>;
  edgeDefaults: Map<string, AttributeValue>;
  derivedClasses: string[];
  isSubgraph: boolean;
}

const EOF_TOKEN: Token = { kind: TokenKind.EOF, value: "", line: 0, column: 0 };

export function parseTokens(tokens: ReadonlyArray<Token>): Graph {
  let pos = 0;

  function tokenAt(index: number): Token {
    return tokens[index] ?? EOF_TOKEN;
  }

  function current(): Token {
    return tokenAt(pos);
  }

  function expect(kind: TokenKind): Token {
    const tok = current();
    if (tok.kind !== kind) {
      throw new ParseError(
        `Expected ${kind} but got ${tok.kind} ("${tok.value}")`,
        tok.line,
        tok.column,
      );
    }
    pos++;
    return tok;
  }

  function match(kind: TokenKind): boolean {
    if (current().kind === kind) {
      pos++;
      return true;
    }
    return false;
  }

  function check(kind: TokenKind): boolean {
    return current().kind === kind;
  }

  // Reject unsupported keywords at the top level
  const first = current();
  if (first.kind === TokenKind.IDENTIFIER && (first.value === "graph" || first.value === "strict")) {
    throw new ParseError(
      `Unsupported: "${first.value}". Only "digraph" is supported`,
      first.line,
      first.column,
    );
  }

  expect(TokenKind.DIGRAPH);

  const nameToken = expect(TokenKind.IDENTIFIER);
  const graphName = nameToken.value;

  expect(TokenKind.LBRACE);

  const graph: Graph = {
    name: graphName,
    attributes: new Map(),
    nodes: new Map(),
    edges: [],
  };

  const rootScope: Scope = {
    nodeDefaults: new Map(),
    edgeDefaults: new Map(),
    derivedClasses: [],
    isSubgraph: false,
  };

  parseStatements(graph, rootScope);

  expect(TokenKind.RBRACE);
  expect(TokenKind.EOF);

  return graph;

  function parseStatements(graph: Graph, scope: Scope): void {
    while (!check(TokenKind.RBRACE) && !check(TokenKind.EOF)) {
      parseStatement(graph, scope);
      match(TokenKind.SEMICOLON);
    }
  }

  function parseStatement(graph: Graph, scope: Scope): void {
    const tok = current();

    // graph [ ... ]
    if (tok.kind === TokenKind.GRAPH) {
      pos++;
      const attrs = parseAttrBlock();
      mergeAttrs(graph.attributes, attrs);
      return;
    }

    // node [ ... ] — sets node defaults
    if (tok.kind === TokenKind.NODE) {
      pos++;
      const attrs = parseAttrBlock();
      mergeAttrs(scope.nodeDefaults, attrs);
      return;
    }

    // edge [ ... ] — sets edge defaults
    if (tok.kind === TokenKind.EDGE) {
      pos++;
      const attrs = parseAttrBlock();
      mergeAttrs(scope.edgeDefaults, attrs);
      return;
    }

    // subgraph
    if (tok.kind === TokenKind.SUBGRAPH) {
      parseSubgraph(graph, scope);
      return;
    }

    // identifier: could be node statement, edge statement, or attr decl
    if (tok.kind === TokenKind.IDENTIFIER) {
      // Peek ahead to determine what this is
      const next = tokenAt(pos + 1);
      if (next.kind === TokenKind.EQUALS) {
        // key = value
        parseAttrDecl(graph, scope);
        return;
      }

      // Could be node or edge statement — parse identifier then check for ->
      const id = expect(TokenKind.IDENTIFIER).value;

      if (check(TokenKind.ARROW)) {
        parseEdgeStatement(graph, scope, id);
        return;
      }

      parseNodeStatement(graph, scope, id);
      return;
    }

    throw new ParseError(
      `Unexpected token: ${tok.kind} ("${tok.value}")`,
      tok.line,
      tok.column,
    );
  }

  function parseAttrDecl(graph: Graph, scope: Scope): void {
    const key = expect(TokenKind.IDENTIFIER).value;
    expect(TokenKind.EQUALS);
    const value = parseValue();

    if (scope.isSubgraph && key === "label") {
      // Inside a subgraph, label is used for class derivation
      const labelStr = attrValueToString(value);
      const className = deriveClassName(labelStr);
      if (className.length > 0) {
        scope.derivedClasses.push(className);
      }
    } else {
      graph.attributes.set(key, value);
    }
  }

  function parseSubgraph(graph: Graph, parentScope: Scope): void {
    expect(TokenKind.SUBGRAPH);

    // Optional identifier
    if (check(TokenKind.IDENTIFIER)) {
      pos++; // consume the subgraph name
    }

    expect(TokenKind.LBRACE);

    // Create child scope inheriting from parent
    const childScope: Scope = {
      nodeDefaults: new Map(parentScope.nodeDefaults),
      edgeDefaults: new Map(parentScope.edgeDefaults),
      derivedClasses: [...parentScope.derivedClasses],
      isSubgraph: true,
    };

    // Track which nodes existed before parsing the subgraph body
    const nodesBefore = new Set(graph.nodes.keys());

    parseStatements(graph, childScope);

    expect(TokenKind.RBRACE);

    // Apply derived classes that were added during subgraph parsing to new nodes
    if (childScope.derivedClasses.length > parentScope.derivedClasses.length) {
      const newClasses = childScope.derivedClasses.slice(parentScope.derivedClasses.length);
      for (const [nodeId, node] of graph.nodes) {
        if (!nodesBefore.has(nodeId)) {
          applyDerivedClasses(node, newClasses);
        }
      }
    }
  }

  function parseNodeStatement(graph: Graph, scope: Scope, id: string): void {
    let node = graph.nodes.get(id);
    if (!node) {
      node = {
        id,
        attributes: new Map(scope.nodeDefaults),
      };
      if (scope.derivedClasses.length > 0) {
        applyDerivedClasses(node, scope.derivedClasses);
      }
      graph.nodes.set(id, node);
    }

    if (check(TokenKind.LBRACKET)) {
      const attrs = parseAttrBlock();
      mergeAttrs(node.attributes, attrs);
    }
  }

  function parseEdgeStatement(
    graph: Graph,
    scope: Scope,
    firstId: string,
  ): void {
    const nodeIds = [firstId];

    while (check(TokenKind.ARROW)) {
      pos++; // consume ->
      const nextId = expect(TokenKind.IDENTIFIER).value;
      nodeIds.push(nextId);
    }

    let edgeAttrs = new Map<string, AttributeValue>();
    if (check(TokenKind.LBRACKET)) {
      edgeAttrs = parseAttrBlock();
    }

    // Ensure all referenced nodes exist
    for (const nodeId of nodeIds) {
      if (!graph.nodes.has(nodeId)) {
        const node: Node = {
          id: nodeId,
          attributes: new Map(scope.nodeDefaults),
        };
        if (scope.derivedClasses.length > 0) {
          applyDerivedClasses(node, scope.derivedClasses);
        }
        graph.nodes.set(nodeId, node);
      }
    }

    // Create edges for each consecutive pair
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const fromId = nodeIds[i];
      const toId = nodeIds[i + 1];
      if (fromId === undefined || toId === undefined) break;
      const edge: Edge = {
        from: fromId,
        to: toId,
        attributes: new Map(scope.edgeDefaults),
      };
      mergeAttrs(edge.attributes, edgeAttrs);
      graph.edges.push(edge);
    }
  }

  function parseAttrBlock(): Map<string, AttributeValue> {
    const attrs = new Map<string, AttributeValue>();
    expect(TokenKind.LBRACKET);

    if (!check(TokenKind.RBRACKET)) {
      parseAttr(attrs);
      while (match(TokenKind.COMMA)) {
        parseAttr(attrs);
      }
    }

    expect(TokenKind.RBRACKET);
    return attrs;
  }

  function parseAttr(attrs: Map<string, AttributeValue>): void {
    let key = expect(TokenKind.IDENTIFIER).value;
    while (match(TokenKind.DOT)) {
      const next = expect(TokenKind.IDENTIFIER).value;
      key += "." + next;
    }
    expect(TokenKind.EQUALS);
    const value = parseValue();
    attrs.set(key, value);
  }

  function parseValue(): AttributeValue {
    const tok = current();

    if (tok.kind === TokenKind.STRING) {
      pos++;
      if (isDurationString(tok.value)) {
        return durationAttr(parseDuration(tok.value), tok.value);
      }
      return stringAttr(tok.value);
    }

    if (tok.kind === TokenKind.DURATION) {
      pos++;
      return durationAttr(parseDuration(tok.value), tok.value);
    }

    if (tok.kind === TokenKind.FLOAT) {
      pos++;
      return floatAttr(parseFloat(tok.value));
    }

    if (tok.kind === TokenKind.INTEGER) {
      pos++;
      return integerAttr(parseInt(tok.value, 10));
    }

    if (tok.kind === TokenKind.TRUE) {
      pos++;
      return booleanAttr(true);
    }

    if (tok.kind === TokenKind.FALSE) {
      pos++;
      return booleanAttr(false);
    }

    // Bare identifier used as a string value (e.g. shape=box, rankdir=LR)
    if (tok.kind === TokenKind.IDENTIFIER) {
      pos++;
      return stringAttr(tok.value);
    }

    throw new ParseError(
      `Expected a value but got ${tok.kind} ("${tok.value}")`,
      tok.line,
      tok.column,
    );
  }
}

function attrValueToString(attr: AttributeValue): string {
  switch (attr.kind) {
    case "string":
      return attr.value;
    case "integer":
      return String(attr.value);
    case "float":
      return String(attr.value);
    case "boolean":
      return String(attr.value);
    case "duration":
      return attr.raw;
  }
}

function mergeAttrs(
  target: Map<string, AttributeValue>,
  source: Map<string, AttributeValue>,
): void {
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

function applyDerivedClasses(node: Node, derivedClasses: ReadonlyArray<string>): void {
  const existing = node.attributes.get("class");
  const existingClasses = existing && existing.kind === "string" && existing.value
    ? existing.value.split(",").map((c) => c.trim())
    : [];
  const allClasses = [...existingClasses];
  for (const cls of derivedClasses) {
    if (!allClasses.includes(cls)) {
      allClasses.push(cls);
    }
  }
  if (allClasses.length > 0) {
    node.attributes.set("class", { kind: "string", value: allClasses.join(",") });
  }
}
