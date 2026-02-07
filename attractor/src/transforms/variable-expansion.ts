import type { Graph, Node, Transform } from "../types/index.js";
import { getStringAttr, stringAttr } from "../types/index.js";

export class VariableExpansionTransform implements Transform {
  apply(graph: Graph): Graph {
    const goal = getStringAttr(graph.attributes, "goal");
    if (goal === "") return graph;

    const newNodes = new Map<string, Node>();
    for (const [id, node] of graph.nodes) {
      const prompt = node.attributes.get("prompt");
      if (prompt === undefined || prompt.kind !== "string" || !prompt.value.includes("$goal")) {
        newNodes.set(id, node);
        continue;
      }

      const newAttrs = new Map(node.attributes);
      newAttrs.set("prompt", stringAttr(prompt.value.replaceAll("$goal", goal)));
      newNodes.set(id, { id, attributes: newAttrs });
    }

    return {
      name: graph.name,
      attributes: graph.attributes,
      nodes: newNodes,
      edges: graph.edges,
    };
  }
}
