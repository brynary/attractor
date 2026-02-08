import { describe, test, expect } from "bun:test";
import { translateResponse } from "../../../src/providers/gemini/response-translator.js";
import { Role } from "../../../src/types/role.js";

describe("Gemini response translator", () => {
  test("translates text response", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "Hello!" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
      },
      modelVersion: "gemini-3-pro-preview",
    };

    const response = translateResponse(body);

    expect(response.model).toBe("gemini-3-pro-preview");
    expect(response.provider).toBe("gemini");
    expect(response.message.role).toBe(Role.ASSISTANT);
    expect(response.message.content).toEqual([
      { kind: "text", text: "Hello!" },
    ]);
    expect(response.finishReason.reason).toBe("stop");
    expect(response.finishReason.raw).toBe("STOP");
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.usage.totalTokens).toBe(15);
    expect(response.warnings).toEqual([]);
  });

  test("translates tool call response with synthetic IDs", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              { text: "I'll check the weather." },
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "NYC" },
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 15,
      },
    };

    const response = translateResponse(body);

    expect(response.message.content).toHaveLength(2);
    expect(response.message.content.at(0)).toEqual({
      kind: "text",
      text: "I'll check the weather.",
    });

    const toolCallPart = response.message.content.at(1);
    expect(toolCallPart?.kind).toBe("tool_call");
    if (toolCallPart?.kind === "tool_call") {
      expect(toolCallPart.toolCall.name).toBe("get_weather");
      expect(toolCallPart.toolCall.arguments).toEqual({ city: "NYC" });
      expect(toolCallPart.toolCall.id).toMatch(/^call_/);
    }

    expect(response.finishReason.reason).toBe("tool_calls");
  });

  test("maps STOP to stop", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "Done" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("stop");
  });

  test("maps MAX_TOKENS to length", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "Truncated" }], role: "model" },
          finishReason: "MAX_TOKENS",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 100 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("length");
  });

  test("maps SAFETY to content_filter", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "" }], role: "model" },
          finishReason: "SAFETY",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("content_filter");
  });

  test("maps RECITATION to content_filter", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "" }], role: "model" },
          finishReason: "RECITATION",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("content_filter");
  });

  test("infers tool_calls finish reason when functionCall present with STOP", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "test", args: {} } },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("tool_calls");
  });

  test("extracts usage with reasoning and cache tokens", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "OK" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 200,
        cachedContentTokenCount: 80,
      },
    };

    const response = translateResponse(body);

    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
    expect(response.usage.totalTokens).toBe(150);
    expect(response.usage.reasoningTokens).toBe(200);
    expect(response.usage.cacheReadTokens).toBe(80);
  });

  test("translates thinking blocks", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "Let me analyze this..." },
              { text: "The answer is 42." },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 25 },
    };

    const response = translateResponse(body);

    expect(response.message.content).toEqual([
      {
        kind: "thinking",
        thinking: { text: "Let me analyze this...", redacted: false },
      },
      { kind: "text", text: "The answer is 42." },
    ]);
  });

  test("passes rateLimit info through", () => {
    const body = {
      candidates: [
        {
          content: { parts: [{ text: "OK" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    };

    const rateLimit = {
      requestsRemaining: 100,
      tokensRemaining: 50000,
    };

    const response = translateResponse(body, rateLimit);

    expect(response.rateLimit).toEqual(rateLimit);
  });
});
