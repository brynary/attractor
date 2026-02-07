import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import { partialJsonParse } from "../utils/json.js";
import { stream } from "./stream.js";
import type { GenerateOptions } from "./generate.js";

export interface StreamObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  schema: Record<string, unknown>;
  schemaName?: string;
}

export async function* streamObject(
  options: StreamObjectOptions,
): AsyncGenerator<unknown> {
  const { schema, schemaName, ...streamOpts } = options;

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
  const { schema, schemaName, ...streamOpts } = options;

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
      textBuffer += event.text;
      const parsed = partialJsonParse(textBuffer);
      if (parsed !== undefined && parsed !== lastParsed) {
        lastParsed = parsed;
        yield parsed;
      }
    }
  }
}
