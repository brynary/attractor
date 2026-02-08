import type { ToolDefinition } from "../types/tool.js";
import { ConfigurationError } from "../types/errors.js";
import { validateToolName } from "./validate-tool-name.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateToolDefinitions(tools?: ToolDefinition[]): void {
  if (!tools) {
    return;
  }

  for (const tool of tools) {
    const nameError = validateToolName(tool.name);
    if (nameError) {
      throw new ConfigurationError(`Invalid tool name "${tool.name}": ${nameError}`);
    }

    if (!isRecord(tool.parameters) || tool.parameters["type"] !== "object") {
      throw new ConfigurationError(
        `Tool "${tool.name}" parameters must have "type": "object" at the root`,
      );
    }
  }
}
