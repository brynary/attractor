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

    const mw1: Middleware = async (req, next) => {
      log.push("mw1-req");
      const res = await next(req);
      log.push("mw1-res");
      return res;
    };

    const mw2: Middleware = async (req, next) => {
      log.push("mw2-req");
      const res = await next(req);
      log.push("mw2-res");
      return { ...res, id: "modified" };
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
          { type: StreamEventType.TEXT_DELTA, text: "hello" },
          { type: StreamEventType.FINISH, finishReason: "stop" },
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
});
