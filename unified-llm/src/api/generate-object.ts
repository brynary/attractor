import type { Message } from "../types/message.js";
import { assistantMessage, userMessage } from "../types/message.js";
import type { ToolChoice } from "../types/tool.js";
import { NoObjectGeneratedError } from "../types/errors.js";
import { safeJsonParse } from "../utils/json.js";
import { validateJsonSchema } from "../utils/validate-json-schema.js";
import { generate } from "./generate.js";
import type { GenerateOptions } from "./generate.js";
import type { GenerateResult } from "./types.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";

export interface GenerateObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  /** JSON schema for structured output */
  schema: Record<string, unknown>;
  /** Schema name (defaults to "extract" for tool strategy) */
  schemaName?: string;
  /** Schema description for the tool or model */
  schemaDescription?: string;
  /** Strategy for structured output: "auto" (choose best), "tool" (use tool calling), or "json_schema" (use native JSON schema). Default: "auto" */
  strategy?: "auto" | "tool" | "json_schema";
  /** Maximum schema-validation retries with feedback (default: 2) */
  maxValidationRetries?: number;
}

export async function generateObject(
  options: GenerateObjectOptions,
): Promise<GenerateResult> {
  const { schema, schemaName, schemaDescription, maxValidationRetries, strategy: explicitStrategy, ...generateOpts } = options;

  const strategy = resolveStrategy(explicitStrategy ?? "auto", options.client ?? getDefaultClient(), options.provider);

  if (strategy === "json_schema") {
    return generateObjectWithJsonSchema({ schema, schemaName, schemaDescription, maxValidationRetries, ...generateOpts });
  }

  const maxRetries = maxValidationRetries ?? 2;

  // Use tool extraction strategy
  const extractToolName = schemaName ?? "extract";
  const extractTool = {
    name: extractToolName,
    description: options.schemaDescription ?? "Extract structured data",
    parameters: schema,
  };

  const toolChoice: ToolChoice = {
    mode: "named" as const,
    toolName: extractToolName,
  };

  const messages: Message[] = generateOpts.messages
    ? [...generateOpts.messages]
    : [];
  const prompt = generateOpts.prompt;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const callOpts =
      attempt === 0 && prompt !== undefined
        ? { ...generateOpts, prompt, messages: undefined }
        : { ...generateOpts, prompt: undefined, messages };

    const result = await generate({
      ...callOpts,
      tools: [extractTool],
      toolChoice,
      maxToolRounds: 0,
    });

    const toolCall = result.toolCalls.find((tc) => tc.name === extractToolName);
    if (!toolCall) {
      lastError =
        "Model did not produce a tool call for structured output extraction";
      // Build messages for retry from the prompt + assistant response
      if (attempt === 0 && prompt !== undefined) {
        messages.push(userMessage(prompt));
      }
      messages.push(result.response.message);
      messages.push(
        userMessage(
          `Your output did not match the expected format: ${lastError}. Please try again.`,
        ),
      );
      continue;
    }

    const validation = validateJsonSchema(toolCall.arguments, schema);
    if (!validation.valid) {
      lastError = `Model output does not match schema: ${validation.errors}`;
      if (attempt === 0 && prompt !== undefined) {
        messages.push(userMessage(prompt));
      }
      messages.push(result.response.message);
      messages.push(
        userMessage(
          `Your output did not match the schema: ${validation.errors}. Please try again.`,
        ),
      );
      continue;
    }

    return {
      ...result,
      output: toolCall.arguments,
    };
  }

  throw new NoObjectGeneratedError(lastError);
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
  const { schema, schemaName, schemaDescription, maxValidationRetries, strategy: _strategy, ...generateOpts } = options;

  const maxRetries = maxValidationRetries ?? 2;
  const messages: Message[] = generateOpts.messages
    ? [...generateOpts.messages]
    : [];
  const prompt = generateOpts.prompt;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const callOpts =
      attempt === 0 && prompt !== undefined
        ? { ...generateOpts, prompt, messages: undefined }
        : { ...generateOpts, prompt: undefined, messages };

    const result = await generate({
      ...callOpts,
      responseFormat: {
        type: "json_schema",
        jsonSchema: schema,
        strict: true,
      },
    });

    const parsed = safeJsonParse(result.text);
    if (!parsed.success) {
      lastError = `Failed to parse model output as JSON: ${parsed.error.message}`;
      if (attempt === 0 && prompt !== undefined) {
        messages.push(userMessage(prompt));
      }
      messages.push(assistantMessage(result.text));
      messages.push(
        userMessage(
          `Your output was not valid JSON: ${parsed.error.message}. Please try again.`,
        ),
      );
      continue;
    }

    const validation = validateJsonSchema(parsed.value, schema);
    if (!validation.valid) {
      lastError = `Model output does not match schema: ${validation.errors}`;
      if (attempt === 0 && prompt !== undefined) {
        messages.push(userMessage(prompt));
      }
      messages.push(assistantMessage(result.text));
      messages.push(
        userMessage(
          `Your output did not match the schema: ${validation.errors}. Please try again.`,
        ),
      );
      continue;
    }

    return {
      ...result,
      output: parsed.value,
    };
  }

  throw new NoObjectGeneratedError(lastError);
}
