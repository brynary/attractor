import type {
  Graph,
  Node,
  StylesheetRule,
} from "../types/index.js";
import { getStringAttr, stringAttr } from "../types/index.js";

function nodeMatchesSelector(node: Node, rule: StylesheetRule): boolean {
  const { selector } = rule;
  switch (selector.kind) {
    case "universal":
      return true;
    case "id":
      return node.id === selector.value;
    case "class": {
      const classAttr = getStringAttr(node.attributes, "class");
      if (classAttr === "") return false;
      const classes = classAttr.split(",").map((c) => c.trim());
      return classes.includes(selector.value);
    }
  }
}

export function applyStylesheet(
  graph: Graph,
  rules: StylesheetRule[],
): Graph {
  // Sort rules by specificity ascending so higher-specificity rules apply last
  // (and thus override lower-specificity ones). For equal specificity, later
  // rules in the original source win, so we use a stable sort.
  const sorted = [...rules].sort(
    (a, b) => a.selector.specificity - b.selector.specificity,
  );

  const newNodes = new Map<string, Node>();

  for (const [id, node] of graph.nodes) {
    const newAttrs = new Map(node.attributes);

    for (const rule of sorted) {
      if (!nodeMatchesSelector(node, rule)) continue;

      for (const decl of rule.declarations) {
        // Only set properties that the node doesn't already have explicitly
        if (!node.attributes.has(decl.property)) {
          newAttrs.set(decl.property, stringAttr(decl.value));
        }
      }
    }

    newNodes.set(id, { id, attributes: newAttrs });
  }

  return {
    name: graph.name,
    attributes: graph.attributes,
    nodes: newNodes,
    edges: graph.edges,
  };
}
