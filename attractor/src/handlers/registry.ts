import type { Handler } from "../types/handler.js";
import type { Node } from "../types/graph.js";
import { getStringAttr } from "../types/graph.js";

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

export class HandlerRegistry {
  private readonly handlers: Map<string, Handler> = new Map();
  private readonly defaultHandler: Handler;

  constructor(defaultHandler: Handler) {
    this.defaultHandler = defaultHandler;
  }

  register(typeString: string, handler: Handler): void {
    this.handlers.set(typeString, handler);
  }

  resolve(node: Node): Handler {
    // 1. Explicit type attribute
    const explicitType = getStringAttr(node.attributes, "type");
    if (explicitType !== "") {
      const handler = this.handlers.get(explicitType);
      if (handler) return handler;
    }

    // 2. Shape-based resolution
    const shape = getStringAttr(node.attributes, "shape");
    const handlerType = SHAPE_TO_TYPE[shape];
    if (handlerType !== undefined) {
      const handler = this.handlers.get(handlerType);
      if (handler) return handler;
    }

    // 3. Default
    return this.defaultHandler;
  }
}
