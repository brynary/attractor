import type { Message } from "../types/message.js";
import { systemMessage, userMessage, toolResultMessage } from "../types/message.js";
import type { ToolDefinition, ToolCall, ToolChoice, ToolExecutionContext } from "../types/tool.js";
import type { ResponseFormat } from "../types/response-format.js";
import type { Request } from "../types/request.js";
import type { Response, Usage } from "../types/response.js";
import { addUsage, responseText, responseToolCalls, responseReasoning } from "../types/response.js";
import type { TimeoutConfig, AdapterTimeout } from "../types/timeout.js";
import { ConfigurationError, RequestTimeoutError, UnsupportedToolChoiceError, InvalidToolCallError } from "../types/errors.js";
import { validateToolName } from "../utils/validate-tool-name.js";
import { validateJsonSchema } from "../utils/validate-json-schema.js";
import { retry } from "../utils/retry.js";
import type { RetryPolicy } from "../utils/retry.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";
import type { StepResult, GenerateResult, StopCondition } from "./types.js";

export type { ToolExecutionContext } from "../types/tool.js";

function toAdapterTimeout(timeout: number | TimeoutConfig, remainingMs?: number): AdapterTimeout {
  if (typeof timeout === "number") {
    const requestMs = remainingMs != null ? Math.min(timeout, remainingMs) : timeout;
    return { connect: 10_000, request: requestMs, streamRead: 30_000 };
  }
  const requestMs = timeout.perStep ?? timeout.total ?? 120_000;
  const clamped = remainingMs != null ? Math.min(requestMs, remainingMs) : requestMs;
  return { connect: 10_000, request: clamped, streamRead: 30_000 };
}

export interface GenerateOptions {
  /** Model identifier (e.g., "gpt-5.2", "claude-opus-4-6", "gemini-3-flash-preview") */
  model: string;
  /** Single-turn text prompt (mutually exclusive with messages) */
  prompt?: string;
  /** Multi-turn message history (mutually exclusive with prompt) */
  messages?: Message[];
  /** System prompt prepended to messages */
  system?: string;
  /** Tool definitions for function calling */
  tools?: ToolDefinition[];
  /** Tool choice strategy (defaults to "auto" when tools are provided) */
  toolChoice?: ToolChoice;
  /** Maximum automatic tool execution rounds (default: 1) */
  maxToolRounds?: number;
  /** Condition to stop tool execution early */
  stopWhen?: StopCondition;
  /** Structured output format */
  responseFormat?: ResponseFormat;
  /** Sampling temperature (typically 0.0-1.0, defaults to provider's default) */
  temperature?: number;
  /** Top-p nucleus sampling (typically 0.0-1.0, defaults to provider's default) */
  topP?: number;
  /** Maximum output tokens (defaults to provider's default) */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Reasoning effort level for reasoning models (e.g., "low", "medium", "high") */
  reasoningEffort?: string;
  /** Provider name (defaults to client's default provider) */
  provider?: string;
  /** Provider-specific options escape hatch */
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Maximum retry attempts for transient failures (default: 2) */
  maxRetries?: number;
  /** Custom retry policy */
  retryPolicy?: RetryPolicy;
  /** Timeout in milliseconds or detailed timeout config (default: 120s per step) */
  timeout?: number | TimeoutConfig;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Optional callback to repair invalid tool call arguments */
  repairToolCall?: (toolCall: ToolCall, error: Error) => Promise<Record<string, unknown>>;
  /** Custom client instance (defaults to global default client) */
  client?: Client;
}

const zeroUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseArguments(raw: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof raw !== "string") return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildToolCall(tc: { id: string; name: string; arguments: Record<string, unknown> | string }) {
  return {
    id: tc.id,
    name: tc.name,
    arguments: parseArguments(tc.arguments),
    rawArguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
  };
}

function buildStepResult(
  response: Response,
  toolResults: { toolCallId: string; content: string | Record<string, unknown> | unknown[]; isError: boolean }[],
): StepResult {
  const text = responseText(response);
  const reasoning = responseReasoning(response) || undefined;
  const rawToolCalls = responseToolCalls(response);
  const toolCalls = rawToolCalls.map(buildToolCall);

  return {
    text,
    reasoning,
    toolCalls,
    toolResults,
    finishReason: response.finishReason,
    usage: response.usage,
    response,
    warnings: response.warnings,
  };
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new ConfigurationError("Cannot specify both 'prompt' and 'messages'");
  }

  const client = options.client ?? getDefaultClient();

  if (options.tools) {
    for (const tool of options.tools) {
      const nameError = validateToolName(tool.name);
      if (nameError) {
        throw new ConfigurationError(`Invalid tool name "${tool.name}": ${nameError}`);
      }
      const params = tool.parameters;
      if (params["type"] !== undefined && params["type"] !== "object") {
        throw new ConfigurationError(
          `Tool "${tool.name}" parameters must have "type": "object" at the root`,
        );
      }
    }
  }

  if (options.toolChoice) {
    const adapter = client.resolveProvider(options.provider);
    if (adapter.supportsToolChoice && !adapter.supportsToolChoice(options.toolChoice.mode)) {
      throw new UnsupportedToolChoiceError(adapter.name, options.toolChoice.mode);
    }
  }

  const messages: Message[] = [];
  if (options.system) {
    messages.push(systemMessage(options.system));
  }
  if (options.prompt !== undefined) {
    messages.push(userMessage(options.prompt));
  } else if (options.messages) {
    messages.push(...options.messages);
  }

  const maxToolRounds = options.maxToolRounds ?? 1;
  const maxRetries = options.maxRetries ?? 2;

  const policy: RetryPolicy = options.retryPolicy ?? {
    maxRetries,
    baseDelay: 1.0,
    maxDelay: 60.0,
    backoffMultiplier: 2.0,
    jitter: true,
  };

  const steps: StepResult[] = [];
  let totalUsage: Usage = { ...zeroUsage };
  let lastResponse: Response | undefined;

  const timeoutCfg = typeof options.timeout === "number"
    ? { total: options.timeout } : options.timeout;
  const totalMs = timeoutCfg?.total;
  const startTime = totalMs != null ? Date.now() : 0;

  for (let round = 0; round <= maxToolRounds; round++) {
    let remainingMs: number | undefined;
    if (totalMs != null) {
      remainingMs = totalMs - (Date.now() - startTime);
      if (remainingMs <= 0) {
        throw new RequestTimeoutError(
          `Total timeout of ${totalMs}ms exceeded`,
        );
      }
    }
    const request: Request = {
      model: options.model,
      messages: [...messages],
      provider: options.provider,
      tools: options.tools,
      toolChoice: options.toolChoice,
      responseFormat: options.responseFormat,
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxTokens,
      stopSequences: options.stopSequences,
      reasoningEffort: options.reasoningEffort,
      providerOptions: options.providerOptions,
      timeout: options.timeout !== undefined ? toAdapterTimeout(options.timeout, remainingMs) : undefined,
      abortSignal: options.abortSignal,
    };

    const response = await retry(
      () => client.complete(request),
      policy,
    );

    lastResponse = response;
    const rawToolCalls = responseToolCalls(response);
    const hasToolCalls =
      response.finishReason.reason === "tool_calls" &&
      rawToolCalls.length > 0 &&
      options.tools &&
      options.tools.length > 0;

    if (hasToolCalls && round < maxToolRounds) {
      // Partition tool calls: passive (defined, no execute), unknown (not defined), active (has execute)
      const passiveCalls: typeof rawToolCalls = [];
      const unknownCalls: typeof rawToolCalls = [];
      const activeCalls: typeof rawToolCalls = [];
      for (const tc of rawToolCalls) {
        const toolDef = options.tools?.find((t) => t.name === tc.name);
        if (!toolDef) {
          unknownCalls.push(tc);
        } else if (!toolDef.execute) {
          passiveCalls.push(tc);
        } else {
          activeCalls.push(tc);
        }
      }

      // If any passive tools, break loop and return to caller
      if (passiveCalls.length > 0) {
        const step = buildStepResult(response, []);
        steps.push(step);
        totalUsage = addUsage(totalUsage, response.usage);
        break;
      }

      // Execute active tool calls + send errors for unknown tools
      const toolResultPromises = rawToolCalls.map(async (tc) => {
        const toolDef = options.tools?.find((t) => t.name === tc.name);
        if (!toolDef) {
          return {
            toolCallId: tc.id,
            content: `Tool "${tc.name}" not found`,
            isError: true,
          };
        }
        if (!toolDef.execute) {
          // Should not reach here (passive tools handled above), but guard anyway
          return {
            toolCallId: tc.id,
            content: `Tool "${tc.name}" has no execute handler`,
            isError: true,
          };
        }

        // Parse arguments
        let args: Record<string, unknown>;
        if (typeof tc.arguments === "string") {
          try {
            const parsed: unknown = JSON.parse(tc.arguments);
            if (!isRecord(parsed)) {
              return {
                toolCallId: tc.id,
                content: "Failed to parse tool call arguments",
                isError: true,
              };
            }
            args = parsed;
          } catch {
            return {
              toolCallId: tc.id,
              content: "Failed to parse tool call arguments",
              isError: true,
            };
          }
        } else {
          args = tc.arguments;
        }

        try {
          // Validate arguments against tool schema if parameters are defined
          if (toolDef.parameters && Object.keys(toolDef.parameters).length > 0) {
            const validation = validateJsonSchema(args, toolDef.parameters);
            if (!validation.valid) {
              const validationError = new InvalidToolCallError(`Tool argument validation failed: ${validation.errors}`);

              // Try repair if provided
              if (options.repairToolCall) {
                const toolCall = buildToolCall(tc);
                args = await options.repairToolCall(toolCall, validationError);
              } else {
                return {
                  toolCallId: tc.id,
                  content: validationError.message,
                  isError: true,
                };
              }
            }
          }

          const context: ToolExecutionContext = {
            messages,
            abortSignal: options.abortSignal,
            toolCallId: tc.id,
          };
          const result = await toolDef.execute(args, context);
          const content: string | Record<string, unknown> | unknown[] =
            typeof result === "string" ? result
            : Array.isArray(result) ? result
            : isRecord(result) ? result
            : String(result);
          return {
            toolCallId: tc.id,
            content,
            isError: false,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            toolCallId: tc.id,
            content: message,
            isError: true,
          };
        }
      });

      const settled = await Promise.allSettled(toolResultPromises);
      const toolResults = settled.map((result, i) => {
        if (result.status === "fulfilled") {
          return result.value;
        }
        const tc = rawToolCalls[i];
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        return {
          toolCallId: tc?.id ?? "",
          content: message,
          isError: true,
        };
      });
      const step = buildStepResult(response, toolResults);
      steps.push(step);
      totalUsage = addUsage(totalUsage, response.usage);

      if (options.stopWhen && options.stopWhen(steps)) {
        break;
      }

      // Append assistant message and tool results to conversation
      messages.push(response.message);
      for (const tr of toolResults) {
        messages.push(toolResultMessage(tr.toolCallId, tr.content, tr.isError));
      }
    } else {
      // Final step - no tool calls or max rounds reached
      const step = buildStepResult(response, []);
      steps.push(step);
      totalUsage = addUsage(totalUsage, response.usage);
      break;
    }
  }

  const lastStep = steps[steps.length - 1];
  if (!lastStep || !lastResponse) {
    throw new ConfigurationError("No steps were executed");
  }

  return {
    text: lastStep.text,
    reasoning: lastStep.reasoning,
    toolCalls: lastStep.toolCalls,
    toolResults: lastStep.toolResults,
    finishReason: lastStep.finishReason,
    usage: lastStep.usage,
    totalUsage,
    steps,
    response: lastResponse,
  };
}
