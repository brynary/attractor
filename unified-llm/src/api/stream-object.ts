import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import { partialJsonParse } from "../utils/json.js";
import { stream } from "./stream.js";
import type { GenerateOptions } from "./generate.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";

export interface StreamObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  schema: Record<string, unknown>;
  schemaName?: string;
  strategy?: "auto" | "tool" | "json_schema";
}

function resolveStreamStrategy(
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

export async function* streamObject(
  options: StreamObjectOptions,
): AsyncGenerator<unknown> {
  const { schema, schemaName, strategy: explicitStrategy, ...streamOpts } = options;

  const resolved = resolveStreamStrategy(explicitStrategy ?? "auto", options.client ?? getDefaultClient(), options.provider);

  if (resolved === "json_schema") {
    yield* streamObjectWithJsonSchema({ schema, schemaName, ...streamOpts });
    return;
  }

  // Use tool extraction strategy with streaming
  const extractToolName = schemaName ?? "extract";
  const extractTool = {
    name: extractToolName,
    description: "Extract structured data",
    parameters: schema,
  };

  const result = stream({
    ...streamOpts,
    tools: [extractTool],
    toolChoice: { mode: "named" as const, toolName: extractToolName },
    maxToolRounds: 0,
  });

  let argumentsBuffer = "";
  let lastParsed: unknown = undefined;

  for await (const event of result) {
    if (event.type === StreamEventType.TOOL_CALL_DELTA) {
      argumentsBuffer += event.argumentsDelta;
      const parsed = partialJsonParse(argumentsBuffer);
      if (parsed !== undefined && parsed !== lastParsed) {
        lastParsed = parsed;
        yield parsed;
      }
    }
  }
}

export async function* streamObjectWithJsonSchema(
  options: StreamObjectOptions,
): AsyncGenerator<unknown> {
  const { schema, schemaName, strategy: _strategy, ...streamOpts } = options;

  const result = stream({
    ...streamOpts,
    responseFormat: {
      type: "json_schema",
      jsonSchema: schema,
      strict: true,
    },
  });

  let textBuffer = "";
  let lastParsed: unknown = undefined;

  for await (const event of result) {
    if (event.type === StreamEventType.TEXT_DELTA) {
      textBuffer += event.delta;
      const parsed = partialJsonParse(textBuffer);
      if (parsed !== undefined && parsed !== lastParsed) {
        lastParsed = parsed;
        yield parsed;
      }
    }
  }
}
