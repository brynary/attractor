export interface StringValue {
  kind: "string";
  value: string;
}

export interface IntegerValue {
  kind: "integer";
  value: number;
}

export interface FloatValue {
  kind: "float";
  value: number;
}

export interface BooleanValue {
  kind: "boolean";
  value: boolean;
}

export interface DurationValue {
  kind: "duration";
  value: number; // milliseconds
  raw: string; // original string e.g. "900s"
}

export type AttributeValue =
  | StringValue
  | IntegerValue
  | FloatValue
  | BooleanValue
  | DurationValue;

export function stringAttr(value: string): StringValue {
  return { kind: "string", value };
}

export function integerAttr(value: number): IntegerValue {
  return { kind: "integer", value };
}

export function floatAttr(value: number): FloatValue {
  return { kind: "float", value };
}

export function booleanAttr(value: boolean): BooleanValue {
  return { kind: "boolean", value };
}

export function durationAttr(ms: number, raw: string): DurationValue {
  return { kind: "duration", value: ms, raw };
}

export function attrToString(attr: AttributeValue): string {
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

export interface Node {
  id: string;
  attributes: Map<string, AttributeValue>;
}

export interface Edge {
  from: string;
  to: string;
  attributes: Map<string, AttributeValue>;
}

export interface Graph {
  name: string;
  attributes: Map<string, AttributeValue>;
  nodes: Map<string, Node>;
  edges: Edge[];
}

export function getStringAttr(
  attrs: Map<string, AttributeValue>,
  key: string,
  defaultValue: string = "",
): string {
  const attr = attrs.get(key);
  if (!attr) return defaultValue;
  return attrToString(attr);
}

export function getIntegerAttr(
  attrs: Map<string, AttributeValue>,
  key: string,
  defaultValue: number = 0,
): number {
  const attr = attrs.get(key);
  if (!attr) return defaultValue;
  if (attr.kind === "integer") return attr.value;
  if (attr.kind === "float") return Math.floor(attr.value);
  if (attr.kind === "string") {
    const n = parseInt(attr.value, 10);
    return isNaN(n) ? defaultValue : n;
  }
  return defaultValue;
}

export function getBooleanAttr(
  attrs: Map<string, AttributeValue>,
  key: string,
  defaultValue: boolean = false,
): boolean {
  const attr = attrs.get(key);
  if (!attr) return defaultValue;
  if (attr.kind === "boolean") return attr.value;
  if (attr.kind === "string") return attr.value === "true";
  return defaultValue;
}

export function getDurationAttr(
  attrs: Map<string, AttributeValue>,
  key: string,
): number | undefined {
  const attr = attrs.get(key);
  if (!attr) return undefined;
  if (attr.kind === "duration") return attr.value;
  if (attr.kind === "integer") return attr.value;
  return undefined;
}

export function outgoingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function incomingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}
