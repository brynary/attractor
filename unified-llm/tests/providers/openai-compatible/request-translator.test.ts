import { describe, test, expect } from "bun:test";
import { translateRequest } from "../../../src/providers/openai-compatible/request-translator.js";
import type { Request } from "../../../src/types/request.js";
import { Role } from "../../../src/types/role.js";

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    model: "llama-3-70b",
    messages: [],
    ...overrides,
  };
}

describe("OpenAI-Compatible Request Translator", () => {
  test("translates simple text message", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [{ kind: "text", text: "Hello" }],
        },
      ],
    });

    const { body } = translateRequest(request, false);

    expect(body.model).toBe("llama-3-70b");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "user", content: "Hello" },
    ]);
  });

  test("translates system message as system role", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: "text", text: "You are helpful." }],
        },
        {
          role: Role.USER,
          content: [{ kind: "text", text: "Hi" }],
        },
      ],
    });

    const { body } = translateRequest(request, false);

    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ]);
  });

  test("translates developer message as system role", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.DEVELOPER,
          content: [{ kind: "text", text: "Dev instructions" }],
        },
        {
          role: Role.USER,
          content: [{ kind: "text", text: "Hi" }],
        },
      ],
    });

    const { body } = translateRequest(request, false);

    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({
      role: "system",
      content: "Dev instructions",
    });
  });

  test("translates tool definitions", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather info",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });

    const { body } = translateRequest(request, false);

    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather info",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      },
    ]);
  });

  test("translates toolChoice auto", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      toolChoice: { mode: "auto" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toBe("auto");
  });

  test("translates toolChoice none", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      toolChoice: { mode: "none" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toBe("none");
  });

  test("translates toolChoice required", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      toolChoice: { mode: "required" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toBe("required");
  });

  test("translates toolChoice named", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      toolChoice: { mode: "named", toolName: "get_weather" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  test("translates image with URL", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: "image",
              image: { url: "https://example.com/image.png" },
            },
          ],
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const messages = body.messages as Array<Record<string, unknown>>;
    const content = messages[0]?.content as Array<Record<string, unknown>>;

    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/image.png" },
    });
  });

  test("translates image with base64 data", () => {
    const data = new Uint8Array([137, 80, 78, 71]);
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: "image",
              image: { data, mediaType: "image/png" },
            },
          ],
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const messages = body.messages as Array<Record<string, unknown>>;
    const content = messages[0]?.content as Array<Record<string, unknown>>;

    expect(content[0]?.type).toBe("image_url");
    const imageUrl = content[0]?.image_url as Record<string, unknown>;
    expect(typeof imageUrl?.url).toBe("string");
    expect((imageUrl?.url as string).startsWith("data:image/png;base64,")).toBe(
      true,
    );
  });

  test("uses multipart content for mixed user message", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "What is this?" },
            {
              kind: "image",
              image: { url: "https://example.com/img.png" },
            },
          ],
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const messages = body.messages as Array<Record<string, unknown>>;
    const content = messages[0]?.content as Array<Record<string, unknown>>;

    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "What is this?" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/img.png" },
    });
  });

  test("translates tool call and tool result", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: {
                id: "call_123",
                name: "get_weather",
                arguments: { city: "SF" },
              },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "call_123",
                content: "72F and sunny",
                isError: false,
              },
            },
          ],
          toolCallId: "call_123",
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const messages = body.messages as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"city":"SF"}',
          },
        },
      ],
    });

    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: "72F and sunny",
    });
  });

  test("prefixes error tool result content with Error:", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: {
                id: "call_err",
                name: "read_file",
                arguments: { path: "/missing" },
              },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "call_err",
                content: "file not found",
                isError: true,
              },
            },
          ],
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const messages = body.messages as Array<Record<string, unknown>>;

    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_err",
      content: "Error: file not found",
    });
  });

  test("maps max_tokens directly", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      maxTokens: 1000,
    });

    const { body } = translateRequest(request, false);
    expect(body.max_tokens).toBe(1000);
  });

  test("translates temperature and topP", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      temperature: 0.7,
      topP: 0.9,
    });

    const { body } = translateRequest(request, false);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });

  test("translates stop sequences", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      stopSequences: ["END", "STOP"],
    });

    const { body } = translateRequest(request, false);
    expect(body.stop).toEqual(["END", "STOP"]);
  });

  test("passes metadata through", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      metadata: { traceId: "trace-123", tenant: "acme" },
    });

    const { body } = translateRequest(request, false);
    expect(body.metadata).toEqual({ traceId: "trace-123", tenant: "acme" });
  });

  test("translates responseFormat json_schema", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    });

    const { body } = translateRequest(request, false);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        strict: false,
      },
    });
  });

  test("translates responseFormat json", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "json" },
    });

    const { body } = translateRequest(request, false);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("sets stream to true for streaming", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    });

    const { body } = translateRequest(request, true);
    expect(body.stream).toBe(true);
  });

  test("includes stream_options with include_usage when streaming", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    });

    const { body } = translateRequest(request, true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  test("does not include stream_options when not streaming", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    });

    const { body } = translateRequest(request, false);
    expect(body.stream_options).toBeUndefined();
  });

  test("merges providerOptions.openai_compatible into body", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        openai_compatible: { seed: 42, user: "user-123" },
      },
    });

    const { body } = translateRequest(request, false);
    expect(body.seed).toBe(42);
    expect(body.user).toBe("user-123");
  });

  test("translates assistant text message", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.ASSISTANT,
          content: [{ kind: "text", text: "I can help with that." }],
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const messages = body.messages as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual({
      role: "assistant",
      content: "I can help with that.",
    });
  });

  test("emits warning for audio content parts", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "Listen" },
            { kind: "audio", audio: { data: new Uint8Array([1, 2]), mediaType: "audio/wav" } },
          ],
        },
      ],
    });

    const { warnings } = translateRequest(request, false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("Audio");
  });

  test("emits warning for document content parts", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "Read" },
            { kind: "document", document: { data: new Uint8Array([1]), mediaType: "application/pdf" } },
          ],
        },
      ],
    });

    const { warnings } = translateRequest(request, false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("Document");
  });
});
