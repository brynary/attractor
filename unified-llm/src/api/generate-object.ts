import type { Message } from "../types/message.js";
import type { ToolChoice } from "../types/tool.js";
import { NoObjectGeneratedError } from "../types/errors.js";
import { safeJsonParse } from "../utils/json.js";
import { generate } from "./generate.js";
import type { GenerateOptions } from "./generate.js";
import type { GenerateResult } from "./types.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";

export interface GenerateObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  schema: Record<string, unknown>;
  schemaName?: string;
  schemaDescription?: string;
  strategy?: "auto" | "tool" | "json_schema";
}

export async function generateObject(
  options: GenerateObjectOptions,
): Promise<GenerateResult> {
  const { schema, schemaName, schemaDescription, strategy: explicitStrategy, ...generateOpts } = options;

  const strategy = resolveStrategy(explicitStrategy ?? "auto", options.client ?? getDefaultClient(), options.provider);

  if (strategy === "json_schema") {
    return generateObjectWithJsonSchema({ schema, schemaName, schemaDescription, ...generateOpts });
  }

  // Use tool extraction strategy
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
    maxToolRounds: 0,
  });

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

function resolveStrategy(
  strategy: "auto" | "tool" | "json_schema",
  client: Client,
  provider?: string,
): "tool" | "json_schema" {
  if (strategy !== "auto") {
    return strategy;
  }
  try {
    const adapter = client.resolveProvider(provider);
    if (adapter.supportsNativeJsonSchema) {
      return "json_schema";
    }
  } catch {
    // If provider resolution fails, fall back to tool
  }
  return "tool";
}

export async function generateObjectWithJsonSchema(
  options: GenerateObjectOptions,
): Promise<GenerateResult> {
  const { schema, schemaName, schemaDescription, strategy: _strategy, ...generateOpts } = options;

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
