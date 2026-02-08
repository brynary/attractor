import type { ToolDefinition } from "unified-llm";
import type { ExecutionEnvironment } from "./execution-env.js";

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: (
    args: Record<string, unknown>,
    env: ExecutionEnvironment,
    signal?: AbortSignal,
  ) => Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  entries(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
