import { describe, test, expect } from "bun:test";
import { Client } from "../../src/client/client.js";
import type { Middleware } from "../../src/client/middleware.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { Response } from "../../src/types/response.js";
import type { Request } from "../../src/types/request.js";
import { Role } from "../../src/types/role.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import { ConfigurationError } from "../../src/types/errors.js";
import type { ProviderAdapter } from "../../src/types/provider-adapter.js";

function makeResponse(text = "hello", provider = "stub"): Response {
  return {
    id: "resp-1",
    model: "test-model",
    provider,
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: "text", text }],
    },
    finishReason: { reason: "stop" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

function makeRequest(model = "test-model", provider?: string): Request {
  return {
    model,
    messages: [{ role: Role.USER, content: [{ kind: "text", text: "hi" }] }],
    provider,
  };
}

describe("Client", () => {
  test("routes to correct provider", async () => {
    const adapter1 = new StubAdapter("provider-a", [
      { response: makeResponse("from-a", "provider-a") },
    ]);
    const adapter2 = new StubAdapter("provider-b", [
      { response: makeResponse("from-b", "provider-b") },
    ]);

    const client = new Client({
      providers: {
        "provider-a": adapter1,
        "provider-b": adapter2,
      },
    });

    const result = await client.complete(makeRequest("test-model", "provider-b"));
    expect(result.provider).toBe("provider-b");
    expect(adapter2.calls).toHaveLength(1);
    expect(adapter1.calls).toHaveLength(0);
  });

  test("uses default provider when none specified in request", async () => {
    const adapter = new StubAdapter("my-provider", [
      { response: makeResponse("hi", "my-provider") },
    ]);

    const client = new Client({
      providers: { "my-provider": adapter },
      defaultProvider: "my-provider",
    });

    const result = await client.complete(makeRequest("test-model"));
    expect(result.provider).toBe("my-provider");
    expect(adapter.calls).toHaveLength(1);
  });

  test("throws ConfigurationError when no provider found", async () => {
    const client = new Client();
    await expect(client.complete(makeRequest())).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("throws ConfigurationError for unknown provider name", async () => {
    const client = new Client({
      providers: { known: new StubAdapter("known", []) },
      defaultProvider: "known",
    });

    await expect(
      client.complete(makeRequest("m", "unknown")),
    ).rejects.toThrow(ConfigurationError);
  });

  test("middleware chain works end-to-end", async () => {
    const adapter = new StubAdapter("test", [
      { response: makeResponse("original") },
    ]);

    const log: string[] = [];

    const mw1: Middleware = {
      complete: async (req, next) => {
        log.push("mw1-req");
        const res = await next(req);
        log.push("mw1-res");
        return res;
      },
    };

    const mw2: Middleware = {
      complete: async (req, next) => {
        log.push("mw2-req");
        const res = await next(req);
        log.push("mw2-res");
        return { ...res, id: "modified" };
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [mw1, mw2],
    });

    const result = await client.complete(makeRequest());
    expect(result.id).toBe("modified");
    expect(log).toEqual(["mw1-req", "mw2-req", "mw2-res", "mw1-res"]);
  });

  test("registerProvider adds provider and sets default", () => {
    const client = new Client();
    const adapter = new StubAdapter("dynamic", [
      { response: makeResponse("dyn") },
    ]);

    client.registerProvider("dynamic", adapter);

    // Should work without specifying provider since it's the default now
    expect(client.complete(makeRequest())).resolves.toBeDefined();
  });

  test("stream yields events from adapter", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "hello" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
    });

    const events = [];
    for await (const event of client.stream(makeRequest())) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      type: StreamEventType.STREAM_START,
      model: "test",
    });
  });

  test("initialize calls initialize on all adapters", async () => {
    const initNames: string[] = [];

    const adapterA: ProviderAdapter = {
      name: "a",
      complete: async () => makeResponse("a"),
      stream: async function* () {},
      initialize: async () => { initNames.push("a"); },
    };

    const adapterB: ProviderAdapter = {
      name: "b",
      complete: async () => makeResponse("b"),
      stream: async function* () {},
      initialize: async () => { initNames.push("b"); },
    };

    const client = new Client({
      providers: { a: adapterA, b: adapterB },
    });

    await client.initialize();
    expect(initNames).toContain("a");
    expect(initNames).toContain("b");
  });

  test("resolveProvider returns the correct adapter", () => {
    const adapter = new StubAdapter("my-provider", []);
    const client = new Client({
      providers: { "my-provider": adapter },
      defaultProvider: "my-provider",
    });

    const resolved = client.resolveProvider("my-provider");
    expect(resolved.name).toBe("my-provider");
  });

  test("fromEnvSync creates client with anthropic when ANTHROPIC_API_KEY set", () => {
    const original = process.env["ANTHROPIC_API_KEY"];
    const originalOpenAI = process.env["OPENAI_API_KEY"];
    const originalGemini = process.env["GEMINI_API_KEY"];
    const originalGoogle = process.env["GOOGLE_API_KEY"];
    const originalCompat = process.env["OPENAI_COMPATIBLE_BASE_URL"];
    try {
      process.env["ANTHROPIC_API_KEY"] = "test-key";
      delete process.env["OPENAI_API_KEY"];
      delete process.env["GEMINI_API_KEY"];
      delete process.env["GOOGLE_API_KEY"];
      delete process.env["OPENAI_COMPATIBLE_BASE_URL"];

      const client = Client.fromEnvSync();
      const adapter = client.resolveProvider("anthropic");
      expect(adapter.name).toBe("anthropic");
    } finally {
      if (original !== undefined) process.env["ANTHROPIC_API_KEY"] = original;
      else delete process.env["ANTHROPIC_API_KEY"];
      if (originalOpenAI !== undefined) process.env["OPENAI_API_KEY"] = originalOpenAI;
      else delete process.env["OPENAI_API_KEY"];
      if (originalGemini !== undefined) process.env["GEMINI_API_KEY"] = originalGemini;
      else delete process.env["GEMINI_API_KEY"];
      if (originalGoogle !== undefined) process.env["GOOGLE_API_KEY"] = originalGoogle;
      else delete process.env["GOOGLE_API_KEY"];
      if (originalCompat !== undefined) process.env["OPENAI_COMPATIBLE_BASE_URL"] = originalCompat;
      else delete process.env["OPENAI_COMPATIBLE_BASE_URL"];
    }
  });

  test("fromEnvSync returns empty client when no env vars set", () => {
    const saved: Record<string, string | undefined> = {};
    const keys = [
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
      "GOOGLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL",
    ];
    try {
      for (const key of keys) {
        saved[key] = process.env[key];
        delete process.env[key];
      }

      const client = Client.fromEnvSync();
      expect(() => client.resolveProvider()).toThrow(ConfigurationError);
    } finally {
      for (const key of keys) {
        if (saved[key] !== undefined) process.env[key] = saved[key];
        else delete process.env[key];
      }
    }
  });

  test("fromEnv returns a promise that resolves to a client", async () => {
    const saved: Record<string, string | undefined> = {};
    const keys = [
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
      "GOOGLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL",
    ];
    try {
      for (const key of keys) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
      process.env["ANTHROPIC_API_KEY"] = "test-key";

      const client = await Client.fromEnv();
      const adapter = client.resolveProvider("anthropic");
      expect(adapter.name).toBe("anthropic");
    } finally {
      for (const key of keys) {
        if (saved[key] !== undefined) process.env[key] = saved[key];
        else delete process.env[key];
      }
    }
  });

  test("close calls close on all adapters", async () => {
    const closedNames: string[] = [];

    const adapterA: ProviderAdapter = {
      name: "a",
      complete: async () => makeResponse("a"),
      stream: async function* () {},
      close: async () => { closedNames.push("a"); },
    };

    const adapterB: ProviderAdapter = {
      name: "b",
      complete: async () => makeResponse("b"),
      stream: async function* () {},
      close: async () => { closedNames.push("b"); },
    };

    const client = new Client({
      providers: { a: adapterA, b: adapterB },
    });

    await client.close();
    expect(closedNames).toContain("a");
    expect(closedNames).toContain("b");
  });

  test("complete passes timeout through to adapter", async () => {
    const adapter = new StubAdapter("test", [
      { response: makeResponse("ok") },
    ]);

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
    });

    await client.complete({
      ...makeRequest(),
      timeout: { connect: 5000, request: 30000, streamRead: 20000 },
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toEqual({
      connect: 5000,
      request: 30000,
      streamRead: 20000,
    });
  });

  test("stream passes timeout through to adapter", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "hi" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
    });

    const gen = client.stream({
      ...makeRequest(),
      timeout: { connect: 5000, request: 30000, streamRead: 20000 },
    });

    const events = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toEqual({
      connect: 5000,
      request: 30000,
      streamRead: 20000,
    });
  });

  test("streaming middleware chain executes in correct order", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "hello" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const log: string[] = [];

    const mw1: Middleware = {
      stream: async function* (req, next) {
        log.push("mw1-req");
        for await (const event of next(req)) {
          log.push("mw1-event");
          yield event;
        }
        log.push("mw1-done");
      },
    };

    const mw2: Middleware = {
      stream: async function* (req, next) {
        log.push("mw2-req");
        for await (const event of next(req)) {
          log.push("mw2-event");
          yield event;
        }
        log.push("mw2-done");
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [mw1, mw2],
    });

    const events = [];
    for await (const event of client.stream(makeRequest())) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(log).toEqual([
      "mw1-req",
      "mw2-req",
      "mw2-event",
      "mw1-event",
      "mw2-event",
      "mw1-event",
      "mw2-event",
      "mw1-event",
      "mw2-done",
      "mw1-done",
    ]);
  });

  test("streaming middleware can modify request", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "modified-model" },
          { type: StreamEventType.TEXT_DELTA, delta: "hi" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const mw: Middleware = {
      stream: async function* (req, next) {
        const modifiedReq = { ...req, model: "modified-model" };
        yield* next(modifiedReq);
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [mw],
    });

    const events = [];
    for await (const event of client.stream(makeRequest("original-model"))) {
      events.push(event);
    }

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.model).toBe("modified-model");
    expect(events[0]).toMatchObject({
      type: StreamEventType.STREAM_START,
      model: "modified-model",
    });
  });

  test("streaming middleware can modify events", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "hello" },
          { type: StreamEventType.TEXT_DELTA, delta: " world" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const mw: Middleware = {
      stream: async function* (req, next) {
        for await (const event of next(req)) {
          if (event.type === StreamEventType.TEXT_DELTA) {
            yield { ...event, delta: event.delta.toUpperCase() };
          } else {
            yield event;
          }
        }
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [mw],
    });

    const events = [];
    for await (const event of client.stream(makeRequest())) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events[1]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: "HELLO",
    });
    expect(events[2]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: " WORLD",
    });
  });

  test("multiple streaming middleware work together", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "a" },
          { type: StreamEventType.TEXT_DELTA, delta: "b" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const prefixMw: Middleware = {
      stream: async function* (req, next) {
        for await (const event of next(req)) {
          if (event.type === StreamEventType.TEXT_DELTA) {
            yield { ...event, delta: `[${event.delta}` };
          } else {
            yield event;
          }
        }
      },
    };

    const suffixMw: Middleware = {
      stream: async function* (req, next) {
        for await (const event of next(req)) {
          if (event.type === StreamEventType.TEXT_DELTA) {
            yield { ...event, delta: `${event.delta}]` };
          } else {
            yield event;
          }
        }
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [prefixMw, suffixMw],
    });

    const events = [];
    for await (const event of client.stream(makeRequest())) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events[1]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: "[a]",
    });
    expect(events[2]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: "[b]",
    });
  });

  test("streaming middleware error handling", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "hello" },
        ],
      },
    ]);

    const errorMw: Middleware = {
      stream: async function* (req, next) {
        for await (const event of next(req)) {
          yield event;
          if (event.type === StreamEventType.TEXT_DELTA) {
            throw new Error("Middleware error");
          }
        }
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [errorMw],
    });

    const events = [];
    let error: Error | undefined;
    try {
      for await (const event of client.stream(makeRequest())) {
        events.push(event);
      }
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toBe("Middleware error");
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);
    expect(events[1]?.type).toBe(StreamEventType.TEXT_DELTA);
  });

  test("streaming middleware without stream method falls back gracefully", async () => {
    const adapter = new StubAdapter("test", [
      {
        events: [
          { type: StreamEventType.STREAM_START, model: "test" },
          { type: StreamEventType.TEXT_DELTA, delta: "hi" },
          { type: StreamEventType.FINISH, finishReason: { reason: "stop" } },
        ],
      },
    ]);

    const completeMw: Middleware = {
      complete: async (req, next) => {
        return next(req);
      },
    };

    const client = new Client({
      providers: { test: adapter },
      defaultProvider: "test",
      middleware: [completeMw],
    });

    const events = [];
    for await (const event of client.stream(makeRequest())) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);
  });
});
