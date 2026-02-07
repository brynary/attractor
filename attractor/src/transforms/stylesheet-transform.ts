import type { Graph, Transform } from "../types/index.js";
import { getStringAttr } from "../types/index.js";
import { parseStylesheet } from "../stylesheet/parser.js";
import { applyStylesheet } from "../stylesheet/apply.js";

export class StylesheetTransform implements Transform {
  apply(graph: Graph): Graph {
    const source = getStringAttr(graph.attributes, "model_stylesheet");
    if (source === "") return graph;

    const rules = parseStylesheet(source);
    if (rules.length === 0) return graph;

    return applyStylesheet(graph, rules);
  }
}
