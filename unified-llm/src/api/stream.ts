import type { Message } from "../types/message.js";
import { systemMessage, userMessage, toolResultMessage } from "../types/message.js";
import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import type { Response, Usage } from "../types/response.js";
import { responseToolCalls, responseText, responseReasoning, addUsage } from "../types/response.js";
import type { AdapterTimeout } from "../types/timeout.js";
import type { TimeoutConfig } from "../types/timeout.js";
import { StreamAccumulator } from "../utils/stream-accumulator.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";
import { AbortError, ConfigurationError, RequestTimeoutError, UnsupportedToolChoiceError, InvalidToolCallError, SDKError, StreamError } from "../types/errors.js";
import { validateToolName } from "../utils/validate-tool-name.js";
import { validateJsonSchema } from "../utils/validate-json-schema.js";
import { retry } from "../utils/retry.js";
import type { RetryPolicy } from "../utils/retry.js";
import type { GenerateOptions, ToolExecutionContext } from "./generate.js";
import type { StepResult, StreamResult } from "./types.js";
import { getLatestModel } from "../models/catalog.js";

function toAdapterTimeout(timeout: number | TimeoutConfig, remainingMs?: number): AdapterTimeout {
  if (typeof timeout === "number") {
    const requestMs = remainingMs != null ? Math.min(timeout, remainingMs) : timeout;
    return { connect: 10_000, request: requestMs, streamRead: 30_000 };
  }
  const requestMs = timeout.perStep ?? timeout.total ?? 120_000;
  const clamped = remainingMs != null ? Math.min(requestMs, remainingMs) : requestMs;
  return { connect: 10_000, request: clamped, streamRead: 30_000 };
}

export type StreamOptions = GenerateOptions;

const zeroUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

class StreamResultImpl implements StreamResult {
  private events: StreamEvent[] = [];
  private responsePromise: Promise<Response>;
  private resolveResponse: ((response: Response) => void) | undefined;
  private iterationStarted = false;
  private generatorFn: () => AsyncGenerator<StreamEvent>;
  private accumulator: StreamAccumulator;
  private _totalUsage: Usage;

  constructor(generatorFn: () => AsyncGenerator<StreamEvent>, provider: string, totalUsageRef: { current: Usage }) {
    this.generatorFn = generatorFn;
    this.accumulator = new StreamAccumulator(provider);
    this._totalUsage = totalUsageRef.current;
    this.responsePromise = new Promise<Response>((resolve) => {
      this.resolveResponse = resolve;
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    if (this.iterationStarted) {
      // Return iterator over cached events
      let index = 0;
      const events = this.events;
      return {
        async next() {
          if (index < events.length) {
            const event = events[index++];
            if (event) {
              return { value: event, done: false };
            }
          }
          return { value: undefined, done: true };
        },
      };
    }
    this.iterationStarted = true;
    const self = this;
    const gen = this.generatorFn();
    const accumulator = this.accumulator;
    return {
      async next() {
        const result = await gen.next();
        if (result.done) {
          const response = accumulator.response();
          self.resolveResponse?.(response);
          return { value: undefined, done: true };
        }
        const event = result.value;
        self.events.push(event);
        accumulator.process(event);
        return { value: event, done: false };
      },
    };
  }

  response(): Promise<Response> {
    if (!this.iterationStarted) {
      // Auto-consume the stream to get the response
      const consume = async () => {
        const iter = this[Symbol.asyncIterator]();
        let result = await iter.next();
        while (!result.done) {
          result = await iter.next();
        }
      };
      consume();
    }
    return this.responsePromise;
  }

  get partialResponse(): Response {
    return this.accumulator.response();
  }

  get textStream(): AsyncGenerator<string> {
    const self = this;
    async function* gen(): AsyncGenerator<string> {
      for await (const event of self) {
        if (event.type === StreamEventType.TEXT_DELTA) {
          yield event.delta;
        }
      }
    }
    return gen();
  }

  get totalUsage(): Usage {
    return this._totalUsage;
  }
}

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

export function stream(options: StreamOptions): StreamResult {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new ConfigurationError("Cannot specify both 'prompt' and 'messages'");
  }
  if (options.prompt === undefined && options.messages === undefined) {
    throw new ConfigurationError("Must specify either 'prompt' or 'messages'");
  }

  const client = options.client ?? getDefaultClient();
  const provider = client.resolveProvider(options.provider).name;
  const model = options.model ?? getLatestModel(provider)?.id;
  if (!model) {
    throw new ConfigurationError(
      `No model specified and no catalog default available for provider "${provider}"`,
    );
  }

  if (options.tools) {
    for (const tool of options.tools) {
      const nameError = validateToolName(tool.name);
      if (nameError) {
        throw new ConfigurationError(`Invalid tool name "${tool.name}": ${nameError}`);
      }
      const params = tool.parameters;
      if (params["type"] !== "object") {
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

  const maxRetries = options.maxRetries ?? 2;

  const policy: RetryPolicy = options.retryPolicy ?? {
    maxRetries,
    baseDelay: 1.0,
    maxDelay: 60.0,
    backoffMultiplier: 2.0,
    jitter: true,
  };

  const totalUsageRef = { current: { ...zeroUsage } };

  const generatorFn = async function* (): AsyncGenerator<StreamEvent> {
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
    const steps: StepResult[] = [];

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
      const request = {
        model,
        messages: [...messages],
        provider,
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
        temperature: options.temperature,
        topP: options.topP,
        maxTokens: options.maxTokens,
        stopSequences: options.stopSequences,
        reasoningEffort: options.reasoningEffort,
        metadata: options.metadata,
        providerOptions: options.providerOptions,
        timeout: options.timeout !== undefined ? toAdapterTimeout(options.timeout, remainingMs) : undefined,
        abortSignal: options.abortSignal,
      };

      const accumulator = new StreamAccumulator(options.provider);

      // Use retry() to handle initial connection + first event read
      let firstEvent: StreamEvent | undefined;
      let connectedStream: AsyncGenerator<StreamEvent> | undefined;

      const connected = await retry(async () => {
        const iter = client.stream(request);
        const result = await iter.next();
        if (!result.done) {
          return { event: result.value, stream: iter };
        }
        return { event: undefined, stream: iter };
      }, policy);

      firstEvent = connected.event;
      connectedStream = connected.stream;

      // Yield the first event and remaining events
      if (firstEvent) {
        accumulator.process(firstEvent);
        if (firstEvent.type === StreamEventType.FINISH) {
          yield { ...firstEvent, response: accumulator.response() };
        } else {
          yield firstEvent;
        }
      }

      if (connectedStream) {
        let streamFailed = false;
        try {
          for await (const event of connectedStream) {
            accumulator.process(event);
            if (event.type === StreamEventType.FINISH) {
              yield { ...event, response: accumulator.response() };
            } else {
              yield event;
            }
          }
        } catch (error) {
          if (error instanceof AbortError) {
            throw error;
          }
          const streamError = error instanceof SDKError
            ? error
            : new StreamError(
              `Stream failed: ${error instanceof Error ? error.message : String(error)}`,
              error instanceof Error ? { cause: error } : undefined,
            );
          yield {
            type: StreamEventType.ERROR,
            error: streamError,
            raw: error,
          };
          streamFailed = true;
        }
        if (streamFailed) {
          break;
        }
      }

      const response = accumulator.response();
      totalUsageRef.current = addUsage(totalUsageRef.current, response.usage);
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
          const step: StepResult = {
            text: responseText(response),
            reasoning: responseReasoning(response) || undefined,
            toolCalls: rawToolCalls.map(buildToolCall),
            toolResults: [],
            finishReason: response.finishReason,
            usage: response.usage,
            response,
            warnings: response.warnings,
          };
          steps.push(step);
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
            return { toolCallId: tc.id, content, isError: false };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { toolCallId: tc.id, content: message, isError: true };
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

        // Emit STEP_FINISH after tool execution, before next model call
        yield {
          type: StreamEventType.STEP_FINISH,
          finishReason: response.finishReason,
          usage: response.usage,
        };

        // Build step result for stopWhen check
        const step: StepResult = {
          text: responseText(response),
          reasoning: responseReasoning(response) || undefined,
          toolCalls: rawToolCalls.map(buildToolCall),
          toolResults,
          finishReason: response.finishReason,
          usage: response.usage,
          response,
          warnings: response.warnings,
        };
        steps.push(step);

        if (options.stopWhen && options.stopWhen(steps)) {
          yield {
            type: StreamEventType.FINISH,
            finishReason: response.finishReason,
            usage: response.usage,
            response,
          };
          break;
        }

        // Append assistant message and tool results
        messages.push(response.message);
        for (const tr of toolResults) {
          messages.push(toolResultMessage(tr.toolCallId, tr.content, tr.isError));
        }
      } else {
        break;
      }
    }
  };

  return new StreamResultImpl(generatorFn, provider, totalUsageRef);
}
