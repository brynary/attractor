import type { Message } from "../types/message.js";
import type { ToolChoice } from "../types/tool.js";
import { NoObjectGeneratedError } from "../types/errors.js";
import { safeJsonParse } from "../utils/json.js";
import { generate } from "./generate.js";
import type { GenerateOptions } from "./generate.js";
import type { GenerateResult } from "./types.js";

export interface GenerateObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  schema: Record<string, unknown>;
  schemaName?: string;
  schemaDescription?: string;
}

export async function generateObject(
  options: GenerateObjectOptions,
): Promise<GenerateResult> {
  const { schema, schemaName, schemaDescription, ...generateOpts } = options;

  // Use tool extraction strategy:
  // Define a tool with the schema, force tool use, extract arguments as output
  const extractToolName = schemaName ?? "extract";
  const extractTool = {
    name: extractToolName,
    description: schemaDescription ?? "Extract structured data",
    parameters: schema,
  };

  const toolChoice: ToolChoice = {
    mode: "named" as const,
    toolName: extractToolName,
  };

  const result = await generate({
    ...generateOpts,
    tools: [extractTool],
    toolChoice,
    maxToolRounds: 0, // Don't execute tools, just extract the call
  });

  // Find the tool call with matching name
  const toolCall = result.toolCalls.find((tc) => tc.name === extractToolName);
  if (!toolCall) {
    throw new NoObjectGeneratedError(
      "Model did not produce a tool call for structured output extraction",
    );
  }

  return {
    ...result,
    output: toolCall.arguments,
  };
}

export async function generateObjectWithJsonSchema(
  options: GenerateObjectOptions,
): Promise<GenerateResult> {
  const { schema, schemaName, schemaDescription, ...generateOpts } = options;

  const result = await generate({
    ...generateOpts,
    responseFormat: {
      type: "json_schema",
      jsonSchema: schema,
      strict: true,
    },
  });

  const parsed = safeJsonParse(result.text);
  if (!parsed.success) {
    throw new NoObjectGeneratedError(
      `Failed to parse model output as JSON: ${parsed.error.message}`,
    );
  }

  return {
    ...result,
    output: parsed.value,
  };
}
