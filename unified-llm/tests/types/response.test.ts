import { describe, test, expect } from "bun:test";
import type { Response, Usage } from "../../src/types/response.js";
import {
  addUsage,
  responseText,
  responseToolCalls,
  responseReasoning,
} from "../../src/types/response.js";
import { Role } from "../../src/types/role.js";

function makeResponse(
  content: Response["message"]["content"],
): Response {
  return {
    id: "test-id",
    model: "test-model",
    provider: "test-provider",
    message: { role: Role.ASSISTANT, content },
    finishReason: { reason: "stop" },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    warnings: [],
  };
}

describe("addUsage", () => {
  test("sums basic token counts", () => {
    const a: Usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const b: Usage = { inputTokens: 5, outputTokens: 15, totalTokens: 20 };
    const result = addUsage(a, b);
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(35);
    expect(result.totalTokens).toBe(50);
  });

  test("sums optional fields when both present", () => {
    const a: Usage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 5,
      cacheReadTokens: 2,
    };
    const b: Usage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 3,
      cacheReadTokens: 4,
    };
    const result = addUsage(a, b);
    expect(result.reasoningTokens).toBe(8);
    expect(result.cacheReadTokens).toBe(6);
  });

  test("handles optional fields when only one is present", () => {
    const a: Usage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 5,
    };
    const b: Usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const result = addUsage(a, b);
    expect(result.reasoningTokens).toBe(5);
    expect(result.cacheWriteTokens).toBeUndefined();
  });

  test("leaves optional fields undefined when neither is present", () => {
    const a: Usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const b: Usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const result = addUsage(a, b);
    expect(result.reasoningTokens).toBeUndefined();
    expect(result.cacheReadTokens).toBeUndefined();
    expect(result.cacheWriteTokens).toBeUndefined();
  });
});

describe("responseText", () => {
  test("extracts text from response", () => {
    const resp = makeResponse([
      { kind: "text", text: "Hello " },
      { kind: "text", text: "world" },
    ]);
    expect(responseText(resp)).toBe("Hello world");
  });

  test("returns empty string when no text parts", () => {
    const resp = makeResponse([]);
    expect(responseText(resp)).toBe("");
  });
});

describe("responseToolCalls", () => {
  test("extracts tool calls from response", () => {
    const resp = makeResponse([
      { kind: "text", text: "Let me call a tool" },
      {
        kind: "tool_call",
        toolCall: { id: "tc-1", name: "search", arguments: { q: "test" } },
      },
      {
        kind: "tool_call",
        toolCall: { id: "tc-2", name: "fetch", arguments: { url: "http://x" } },
      },
    ]);
    const calls = responseToolCalls(resp);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.name).toBe("search");
    expect(calls[1]?.name).toBe("fetch");
  });
});

describe("responseReasoning", () => {
  test("extracts reasoning from response", () => {
    const resp = makeResponse([
      {
        kind: "thinking",
        thinking: { text: "Let me think about this...", redacted: false },
      },
      { kind: "text", text: "Here is my answer" },
    ]);
    expect(responseReasoning(resp)).toBe("Let me think about this...");
  });

  test("returns empty string when no reasoning", () => {
    const resp = makeResponse([{ kind: "text", text: "answer" }]);
    expect(responseReasoning(resp)).toBe("");
  });
});
