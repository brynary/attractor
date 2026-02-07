import type { Graph } from "./graph.js";

export interface Transform {
  apply(graph: Graph): Graph;
}
