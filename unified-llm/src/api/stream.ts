import type { Message } from "../types/message.js";
import { systemMessage, userMessage, toolResultMessage } from "../types/message.js";
import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import type { Response } from "../types/response.js";
import { responseToolCalls } from "../types/response.js";
import { StreamAccumulator } from "../utils/stream-accumulator.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";
import { ConfigurationError } from "../types/errors.js";
import type { GenerateOptions } from "./generate.js";
import type { StreamResult } from "./types.js";

export type StreamOptions = GenerateOptions;

class StreamResultImpl implements StreamResult {
  private events: StreamEvent[] = [];
  private responsePromise: Promise<Response>;
  private resolveResponse: ((response: Response) => void) | undefined;
  private iterationStarted = false;
  private generatorFn: () => AsyncGenerator<StreamEvent>;

  constructor(generatorFn: () => AsyncGenerator<StreamEvent>) {
    this.generatorFn = generatorFn;
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
    const accumulator = new StreamAccumulator();
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

  async *textStream(): AsyncGenerator<string> {
    for await (const event of this) {
      if (event.type === StreamEventType.TEXT_DELTA) {
        yield event.text;
      }
    }
  }
}

export function stream(options: StreamOptions): StreamResult {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new ConfigurationError("Cannot specify both 'prompt' and 'messages'");
  }

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
    const client = options.client ?? getDefaultClient();

    for (let round = 0; round <= maxToolRounds; round++) {
      const request = {
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

      const accumulator = new StreamAccumulator();

      for await (const event of client.stream(request)) {
        accumulator.process(event);
        yield event;
      }

      const response = accumulator.response();
      const rawToolCalls = responseToolCalls(response);
      const hasToolCalls =
        response.finishReason.reason === "tool_calls" &&
        rawToolCalls.length > 0 &&
        options.tools &&
        options.tools.length > 0;

      if (hasToolCalls && round < maxToolRounds) {
        // Execute tool calls
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
            return { toolCallId: tc.id, content, isError: false };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { toolCallId: tc.id, content: message, isError: true };
          }
        });

        const toolResults = await Promise.all(toolResultPromises);

        // Append assistant message and tool results
        messages.push(response.message);
        for (const tr of toolResults) {
          const content = typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content);
          messages.push(toolResultMessage(tr.toolCallId, content, tr.isError));
        }
      } else {
        break;
      }
    }
  };

  return new StreamResultImpl(generatorFn);
}
