import type { ProviderAdapter } from "../types/provider-adapter.js";
import type { Request } from "../types/request.js";
import type { Response } from "../types/response.js";
import type { StreamEvent } from "../types/stream-event.js";
import { ConfigurationError } from "../types/errors.js";
import type { Middleware } from "./middleware.js";
import { getLatestModel } from "../models/catalog.js";
import {
  buildMiddlewareChain,
  buildStreamMiddlewareChain,
} from "./middleware.js";
import { StreamAccumulator } from "../utils/stream-accumulator.js";
import { StreamEventType } from "../types/stream-event.js";
import { AnthropicAdapter } from "../providers/anthropic/index.js";
import { OpenAIAdapter } from "../providers/openai/index.js";
import { OpenAICompatibleAdapter } from "../providers/openai-compatible/index.js";
import { GeminiAdapter } from "../providers/gemini/index.js";
import { validateToolDefinitions } from "../utils/validate-tools.js";

export interface ClientOptions {
  providers?: Record<string, ProviderAdapter>;
  defaultProvider?: string;
  middleware?: Middleware[];
}

export class Client {
  private providers: Map<string, ProviderAdapter>;
  private defaultProvider: string | undefined;
  private middleware: Middleware[];

  constructor(options: ClientOptions = {}) {
    this.providers = new Map();
    if (options.providers) {
      for (const [name, adapter] of Object.entries(options.providers)) {
        this.providers.set(name, adapter);
      }
    }
    this.defaultProvider = options.defaultProvider;
    this.middleware = options.middleware ?? [];
  }

  resolveProvider(providerName?: string): ProviderAdapter {
    const name = providerName ?? this.defaultProvider;
    if (!name) {
      throw new ConfigurationError(
        "No provider specified and no default provider configured",
      );
    }
    const adapter = this.providers.get(name);
    if (!adapter) {
      throw new ConfigurationError(`Provider "${name}" is not registered`);
    }
    return adapter;
  }

  private applyDefaultModel(request: Request, providerName: string): Request {
    if (request.model) {
      return request;
    }
    const latest = getLatestModel(providerName);
    if (latest) {
      return { ...request, model: latest.id };
    }
    return request;
  }

  async complete(request: Request): Promise<Response> {
    const adapter = this.resolveProvider(request.provider);
    const withProvider = request.provider
      ? request
      : { ...request, provider: adapter.name };
    const resolved = this.applyDefaultModel(withProvider, adapter.name);
    validateToolDefinitions(resolved.tools);
    const handler = async (req: Request): Promise<Response> => {
      const response = await adapter.complete(req);
      return { ...response, provider: adapter.name };
    };
    const chain = buildMiddlewareChain(this.middleware, handler);
    return chain(resolved);
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    const adapter = this.resolveProvider(request.provider);
    const withProvider = request.provider
      ? request
      : { ...request, provider: adapter.name };
    const resolved = this.applyDefaultModel(withProvider, adapter.name);
    validateToolDefinitions(resolved.tools);
    const baseHandler = (req: Request): AsyncGenerator<StreamEvent> =>
      adapter.stream(req);
    const chain = buildStreamMiddlewareChain(
      this.middleware,
      baseHandler,
    );
    const accumulator = new StreamAccumulator(adapter.name);
    for await (const event of chain(resolved)) {
      accumulator.process(event);
      if (event.type === StreamEventType.FINISH) {
        yield {
          ...event,
          response: event.response ?? accumulator.response(),
        };
      } else {
        yield event;
      }
    }
  }

  registerProvider(name: string, adapter: ProviderAdapter): void {
    this.providers.set(name, adapter);
    if (!this.defaultProvider) {
      this.defaultProvider = name;
    }
  }

  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const adapter of this.providers.values()) {
      if (adapter.close) {
        closePromises.push(adapter.close());
      }
    }
    await Promise.all(closePromises);
  }

  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const adapter of this.providers.values()) {
      if (adapter.initialize) {
        promises.push(adapter.initialize());
      }
    }
    await Promise.all(promises);
  }

  static fromEnvSync(): Client {
    const client = new Client();

    const anthropicKey = process.env["ANTHROPIC_API_KEY"];
    if (anthropicKey) {
      client.registerProvider(
        "anthropic",
        new AnthropicAdapter({
          apiKey: anthropicKey,
          baseUrl: process.env["ANTHROPIC_BASE_URL"],
        }),
      );
    }

    const openaiKey = process.env["OPENAI_API_KEY"];
    if (openaiKey) {
      client.registerProvider(
        "openai",
        new OpenAIAdapter({
          apiKey: openaiKey,
          baseUrl: process.env["OPENAI_BASE_URL"],
          orgId: process.env["OPENAI_ORG_ID"],
          projectId: process.env["OPENAI_PROJECT_ID"],
        }),
      );
    }

    const geminiKey =
      process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
    if (geminiKey) {
      client.registerProvider(
        "gemini",
        new GeminiAdapter({
          apiKey: geminiKey,
          baseUrl: process.env["GEMINI_BASE_URL"],
        }),
      );
    }

    const compatBaseUrl = process.env["OPENAI_COMPATIBLE_BASE_URL"];
    if (compatBaseUrl) {
      client.registerProvider(
        "openai-compatible",
        new OpenAICompatibleAdapter({
          baseUrl: compatBaseUrl,
          apiKey: process.env["OPENAI_COMPATIBLE_API_KEY"],
        }),
      );
    }

    return client;
  }

  static async fromEnv(): Promise<Client> {
    const client = Client.fromEnvSync();
    await client.initialize();
    return client;
  }
}
