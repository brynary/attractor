import { describe, test, expect } from "bun:test";
import { AnthropicAdapter } from "../../../src/providers/anthropic/adapter.js";
import {
  AuthenticationError,
  NotFoundError,
  ContextLengthError,
  ContentFilterError,
  QuotaExceededError,
  InvalidRequestError,
  RequestTimeoutError,
} from "../../../src/types/errors.js";

describe("AnthropicAdapter mapError", () => {
  test("maps 408 to RequestTimeoutError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "timeout", message: "Request timeout" } }),
          { status: 408, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RequestTimeoutError);
      const error = caught as RequestTimeoutError;
      expect(error.retryable).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("maps 413 to ContextLengthError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "request_too_large", message: "Request too large" } }),
          { status: 413, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContextLengthError);
      expect((caught as ContextLengthError).retryable).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("sets errorCode from response error type", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "authentication_error", message: "Invalid key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
      expect((caught as AuthenticationError).errorCode).toBe("authentication_error");
    } finally {
      server.stop(true);
    }
  });

  test("maps 422 to InvalidRequestError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request", message: "Unprocessable" } }),
          { status: 422, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InvalidRequestError);
      expect((caught as InvalidRequestError).retryable).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("maps context length message on 400 to ContextLengthError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "Request exceeds maximum context length" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContextLengthError);
    } finally {
      server.stop(true);
    }
  });

  test("maps not_found message in fallback to NotFoundError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "not_found_error", message: "Model does not exist" } }),
          { status: 418, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NotFoundError);
    } finally {
      server.stop(true);
    }
  });

  test("maps auth message in fallback to AuthenticationError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "auth_error", message: "Invalid API key provided" } }),
          { status: 418, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
    } finally {
      server.stop(true);
    }
  });

  test("maps content filter message to ContentFilterError on 400", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "Output blocked by content filter" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContentFilterError);
    } finally {
      server.stop(true);
    }
  });

  test("maps quota message to QuotaExceededError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "billing_error", message: "Quota exceeded for this billing period" } }),
          { status: 402, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(QuotaExceededError);
    } finally {
      server.stop(true);
    }
  });
});

describe("AnthropicAdapter caching behavior", () => {
  test("includes cache beta header and cache_control by default", async () => {
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: Record<string, unknown> = {};

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        receivedBody = await req.json() as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: "claude-opus-4-6",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      await adapter.complete({
        model: "claude-opus-4-6",
        messages: [
          { role: "user", content: [{ kind: "text", text: "Hello" }] },
        ],
      });

      expect(receivedHeaders["anthropic-beta"]).toContain("prompt-caching-2024-07-31");
      const system = receivedBody.system as Array<Record<string, unknown>> | undefined;
      if (system && system.length > 0) {
        expect(system[system.length - 1]?.cache_control).toBeDefined();
      }
    } finally {
      server.stop(true);
    }
  });

  test("disables caching when provider_options.anthropic.auto_cache is false", async () => {
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: Record<string, unknown> = {};

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        receivedBody = await req.json() as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: "claude-opus-4-6",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      await adapter.complete({
        model: "claude-opus-4-6",
        messages: [
          { role: "user", content: [{ kind: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            auto_cache: false,
          },
        },
      });

      const betaHeader = receivedHeaders["anthropic-beta"];
      if (betaHeader) {
        expect(betaHeader).not.toContain("prompt-caching-2024-07-31");
      } else {
        expect(betaHeader).toBeUndefined();
      }
      const system = receivedBody.system as Array<Record<string, unknown>> | undefined;
      if (system && system.length > 0) {
        expect(system[system.length - 1]?.cache_control).toBeUndefined();
      }
    } finally {
      server.stop(true);
    }
  });

  test("disables caching when provider_options.anthropic.autoCache is false (camelCase legacy)", async () => {
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: Record<string, unknown> = {};

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        receivedBody = await req.json() as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: "claude-opus-4-6",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      await adapter.complete({
        model: "claude-opus-4-6",
        messages: [
          { role: "user", content: [{ kind: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            autoCache: false,
          },
        },
      });

      const betaHeader = receivedHeaders["anthropic-beta"];
      if (betaHeader) {
        expect(betaHeader).not.toContain("prompt-caching-2024-07-31");
      } else {
        expect(betaHeader).toBeUndefined();
      }
      const system = receivedBody.system as Array<Record<string, unknown>> | undefined;
      if (system && system.length > 0) {
        expect(system[system.length - 1]?.cache_control).toBeUndefined();
      }
    } finally {
      server.stop(true);
    }
  });

  test("enables caching when auto_cache is explicitly true", async () => {
    let receivedHeaders: Record<string, string> = {};

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        return new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: "claude-opus-4-6",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      await adapter.complete({
        model: "claude-opus-4-6",
        messages: [
          { role: "user", content: [{ kind: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            auto_cache: true,
          },
        },
      });

      expect(receivedHeaders["anthropic-beta"]).toContain("prompt-caching-2024-07-31");
    } finally {
      server.stop(true);
    }
  });

  test("disables caching in streaming when auto_cache is false", async () => {
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: Record<string, unknown> = {};

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        receivedBody = await req.json() as Record<string, unknown>;
        return new Response(
          `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-opus-4-6","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      const stream = adapter.stream({
        model: "claude-opus-4-6",
        messages: [
          { role: "user", content: [{ kind: "text", text: "Hello" }] },
        ],
        providerOptions: {
          anthropic: {
            auto_cache: false,
          },
        },
      });

      // Consume the stream
      for await (const _event of stream) {
        // Just consume it
      }

      const betaHeader = receivedHeaders["anthropic-beta"];
      if (betaHeader) {
        expect(betaHeader).not.toContain("prompt-caching-2024-07-31");
      } else {
        expect(betaHeader).toBeUndefined();
      }
      const system = receivedBody.system as Array<Record<string, unknown>> | undefined;
      if (system && system.length > 0) {
        expect(system[system.length - 1]?.cache_control).toBeUndefined();
      }
    } finally {
      server.stop(true);
    }
  });
});
