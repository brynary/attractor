import { describe, test, expect } from "bun:test";
import { parseSSE } from "../../src/utils/sse.js";
import type { SSEEvent } from "../../src/utils/sse.js";

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collectEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSE(stream)) {
    events.push(event);
  }
  return events;
}

describe("parseSSE", () => {
  test("parses basic SSE events", async () => {
    const data = "data: hello\n\ndata: world\n\n";
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "message", data: "hello" });
    expect(events[1]).toEqual({ event: "message", data: "world" });
  });

  test("parses named events", async () => {
    const data = "event: delta\ndata: chunk1\n\nevent: done\ndata: [DONE]\n\n";
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "delta", data: "chunk1" });
    expect(events[1]).toEqual({ event: "done", data: "[DONE]" });
  });

  test("handles multi-line data", async () => {
    const data = "data: line1\ndata: line2\ndata: line3\n\n";
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: "message",
      data: "line1\nline2\nline3",
    });
  });

  test("ignores comment lines", async () => {
    const data = ": this is a comment\ndata: actual data\n\n";
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: "message", data: "actual data" });
  });

  test("handles JSON data", async () => {
    const jsonPayload = JSON.stringify({ text: "hello", id: 1 });
    const data = `data: ${jsonPayload}\n\n`;
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]?.data ?? "")).toEqual({
      text: "hello",
      id: 1,
    });
  });

  test("handles chunked delivery", async () => {
    const encoder = new TextEncoder();
    const chunks = ["data: hel", "lo\n\ndata: wor", "ld\n\n"];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    const events = await collectEvents(stream);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "message", data: "hello" });
    expect(events[1]).toEqual({ event: "message", data: "world" });
  });

  test("handles carriage return line endings", async () => {
    const data = "data: hello\r\n\r\ndata: world\r\n\r\n";
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "message", data: "hello" });
    expect(events[1]).toEqual({ event: "message", data: "world" });
  });

  test("parses retry field when present", async () => {
    const data = "event: update\nretry: 1500\ndata: payload\n\n";
    const events = await collectEvents(makeStream(data));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: "update",
      data: "payload",
      retry: 1500,
    });
  });
});
