import type { Graph, Transform } from "../types/index.js";

export class TransformRegistry {
  private readonly transforms: Transform[] = [];

  register(transform: Transform): void {
    this.transforms.push(transform);
  }

  apply(graph: Graph): Graph {
    let result = graph;
    for (const transform of this.transforms) {
      result = transform.apply(result);
    }
    return result;
  }
}
