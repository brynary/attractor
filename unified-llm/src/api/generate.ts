import type { Message } from "../types/message.js";
import { systemMessage, userMessage, toolResultMessage } from "../types/message.js";
import type { ToolDefinition, ToolChoice } from "../types/tool.js";
import type { ResponseFormat } from "../types/response-format.js";
import type { Request } from "../types/request.js";
import type { Response, Usage } from "../types/response.js";
import { addUsage, responseText, responseToolCalls, responseReasoning } from "../types/response.js";
import type { TimeoutConfig } from "../types/timeout.js";
import { ConfigurationError } from "../types/errors.js";
import { retry } from "../utils/retry.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";
import type { StepResult, GenerateResult, StopCondition } from "./types.js";

export interface GenerateOptions {
  model: string;
  prompt?: string;
  messages?: Message[];
  system?: string;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  maxToolRounds?: number;
  stopWhen?: StopCondition;
  responseFormat?: ResponseFormat;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  reasoningEffort?: string;
  provider?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
  maxRetries?: number;
  timeout?: number | TimeoutConfig;
  abortSignal?: AbortSignal;
  client?: Client;
}

const zeroUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function buildToolCall(tc: { id: string; name: string; arguments: Record<string, unknown> | string }) {
  return {
    id: tc.id,
    name: tc.name,
    arguments: typeof tc.arguments === "string" ? {} : tc.arguments,
    rawArguments: typeof tc.arguments === "string" ? tc.arguments : undefined,
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
  const client = options.client ?? getDefaultClient();

  const steps: StepResult[] = [];
  let totalUsage: Usage = { ...zeroUsage };
  let lastResponse: Response | undefined;

  for (let round = 0; round <= maxToolRounds; round++) {
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
    };

    const response = await retry(
      () => client.complete(request),
      { maxRetries, baseDelay: 1.0, maxDelay: 60.0, backoffMultiplier: 2.0, jitter: true },
    );

    lastResponse = response;
    const rawToolCalls = responseToolCalls(response);
    const hasToolCalls =
      response.finishReason.reason === "tool_calls" &&
      rawToolCalls.length > 0 &&
      options.tools &&
      options.tools.length > 0;

    if (hasToolCalls && round < maxToolRounds) {
      // Execute all tool calls concurrently
      const toolResultPromises = rawToolCalls.map(async (tc) => {
        const toolDef = options.tools?.find((t) => t.name === tc.name);
        if (!toolDef?.execute) {
          return {
            toolCallId: tc.id,
            content: `Tool "${tc.name}" not found or has no execute handler`,
            isError: true,
          };
        }

        try {
          const args = typeof tc.arguments === "string" ? {} : tc.arguments;
          const result = await toolDef.execute(args);
          const content = typeof result === "string" ? result : JSON.stringify(result);
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

      const toolResults = await Promise.all(toolResultPromises);
      const step = buildStepResult(response, toolResults);
      steps.push(step);
      totalUsage = addUsage(totalUsage, response.usage);

      if (options.stopWhen && options.stopWhen(steps)) {
        break;
      }

      // Append assistant message and tool results to conversation
      messages.push(response.message);
      for (const tr of toolResults) {
        const content = typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content);
        messages.push(toolResultMessage(tr.toolCallId, content, tr.isError));
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
