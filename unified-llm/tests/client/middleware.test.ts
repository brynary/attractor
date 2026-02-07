import { describe, test, expect } from "bun:test";
import {
  buildMiddlewareChain,
  buildStreamMiddlewareChain,
} from "../../src/client/middleware.js";
import type { Middleware, StreamMiddleware } from "../../src/client/middleware.js";
import type { Request } from "../../src/types/request.js";
import type { Response } from "../../src/types/response.js";
import type { StreamEvent } from "../../src/types/stream-event.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import { Role } from "../../src/types/role.js";

function makeRequest(model = "test-model"): Request {
  return {
    model,
    messages: [{ role: Role.USER, content: [{ kind: "text", text: "hello" }] }],
  };
}

function makeResponse(text = "response"): Response {
  return {
    id: "resp-1",
    model: "test-model",
    provider: "test",
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: "text", text }],
    },
    finishReason: { reason: "stop" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

describe("buildMiddlewareChain", () => {
  test("executes handler when no middleware", async () => {
    const handler = async (_req: Request) => makeResponse("base");
    const chain = buildMiddlewareChain([], handler);
    const result = await chain(makeRequest());
    expect(result.message.content[0]).toEqual({ kind: "text", text: "base" });
  });

  test("middleware executes in registration order (request phase)", async () => {
    const order: string[] = [];

    const mw1: Middleware = async (req, next) => {
      order.push("mw1-before");
      const res = await next(req);
      order.push("mw1-after");
      return res;
    };

    const mw2: Middleware = async (req, next) => {
      order.push("mw2-before");
      const res = await next(req);
      order.push("mw2-after");
      return res;
    };

    const handler = async (_req: Request) => {
      order.push("handler");
      return makeResponse();
    };

    const chain = buildMiddlewareChain([mw1, mw2], handler);
    await chain(makeRequest());

    expect(order).toEqual([
      "mw1-before",
      "mw2-before",
      "handler",
      "mw2-after",
      "mw1-after",
    ]);
  });

  test("middleware can modify request", async () => {
    const mw: Middleware = async (req, next) => {
      return next({ ...req, model: "modified-model" });
    };

    let capturedModel = "";
    const handler = async (req: Request) => {
      capturedModel = req.model;
      return makeResponse();
    };

    const chain = buildMiddlewareChain([mw], handler);
    await chain(makeRequest());

    expect(capturedModel).toBe("modified-model");
  });

  test("middleware can modify response", async () => {
    const mw: Middleware = async (req, next) => {
      const res = await next(req);
      return { ...res, id: "modified-id" };
    };

    const handler = async (_req: Request) => makeResponse();
    const chain = buildMiddlewareChain([mw], handler);
    const result = await chain(makeRequest());

    expect(result.id).toBe("modified-id");
  });
});

describe("buildStreamMiddlewareChain", () => {
  test("stream middleware passes events through", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test" },
      { type: StreamEventType.TEXT_DELTA, text: "hello" },
      { type: StreamEventType.FINISH, finishReason: "stop" },
    ];

    const handler = async function* (_req: Request): AsyncGenerator<StreamEvent> {
      for (const e of events) {
        yield e;
      }
    };

    const chain = buildStreamMiddlewareChain([], handler);
    const collected: StreamEvent[] = [];
    for await (const event of chain(makeRequest())) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
  });

  test("stream middleware can intercept events", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test" },
      { type: StreamEventType.TEXT_DELTA, text: "hello" },
      { type: StreamEventType.FINISH, finishReason: "stop" },
    ];

    const handler = async function* (_req: Request): AsyncGenerator<StreamEvent> {
      for (const e of events) {
        yield e;
      }
    };

    const mw: StreamMiddleware = async function* (req, next) {
      for await (const event of next(req)) {
        if (event.type === StreamEventType.TEXT_DELTA) {
          yield { ...event, text: event.text.toUpperCase() };
        } else {
          yield event;
        }
      }
    };

    const chain = buildStreamMiddlewareChain([mw], handler);
    const collected: StreamEvent[] = [];
    for await (const event of chain(makeRequest())) {
      collected.push(event);
    }

    expect(collected[1]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      text: "HELLO",
    });
  });
});
