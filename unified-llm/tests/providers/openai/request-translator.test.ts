import { describe, test, expect } from "bun:test";
import { translateRequest } from "../../../src/providers/openai/request-translator.js";
import type { Request } from "../../../src/types/request.js";
import type { Message } from "../../../src/types/message.js";
import { Role } from "../../../src/types/role.js";

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    model: "gpt-4o",
    messages: [],
    ...overrides,
  };
}

describe("OpenAI Request Translator", () => {
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

    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(false);
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
    ]);
  });

  test("extracts system message to instructions", () => {
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

    expect(body.instructions).toBe("You are helpful.");
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hi" }],
      },
    ]);
  });

  test("extracts developer message to instructions", () => {
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

    expect(body.instructions).toBe("Dev instructions");
  });

  test("concatenates multiple system/developer messages", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: "text", text: "First" }],
        },
        {
          role: Role.DEVELOPER,
          content: [{ kind: "text", text: "Second" }],
        },
        {
          role: Role.USER,
          content: [{ kind: "text", text: "Hi" }],
        },
      ],
    });

    const { body } = translateRequest(request, false);

    expect(body.instructions).toBe("First\nSecond");
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
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    });

    const { body } = translateRequest(request, false);

    expect(body.tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Get weather info",
        parameters: { type: "object", properties: { city: { type: "string" } }, additionalProperties: false },
        strict: true,
      },
    ]);
  });

  test("translates toolChoice auto", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      toolChoice: { mode: "auto" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toBe("auto");
  });

  test("translates toolChoice none", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      toolChoice: { mode: "none" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toBe("none");
  });

  test("translates toolChoice required", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      toolChoice: { mode: "required" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toBe("required");
  });

  test("translates toolChoice named", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      toolChoice: { mode: "named", toolName: "get_weather" },
    });

    const { body } = translateRequest(request, false);
    expect(body.tool_choice).toEqual({ type: "function", name: "get_weather" });
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
    const input = body.input as Array<Record<string, unknown>>;
    const msg = input[0] as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>>;

    expect(content[0]).toEqual({
      type: "input_image",
      image_url: "https://example.com/image.png",
    });
  });

  test("translates image with base64 data", () => {
    const data = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
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
    const input = body.input as Array<Record<string, unknown>>;
    const msg = input[0] as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>>;

    expect(content[0]?.type).toBe("input_image");
    const imageUrl = content[0]?.image_url as string;
    expect(imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  test("translates tool call and tool result as input items", () => {
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
    const input = body.input as Array<Record<string, unknown>>;

    expect(input[0]).toEqual({
      type: "function_call",
      call_id: "call_123",
      name: "get_weather",
      arguments: '{"city":"SF"}',
    });

    expect(input[1]).toEqual({
      type: "function_call_output",
      call_id: "call_123",
      output: "72F and sunny",
    });
  });

  test("maps reasoning_effort to reasoning.effort", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      reasoningEffort: "high",
    });

    const { body } = translateRequest(request, false);
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  test("maps max_tokens to max_output_tokens", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      maxTokens: 1000,
    });

    const { body } = translateRequest(request, false);
    expect(body.max_output_tokens).toBe(1000);
    expect(body.max_tokens).toBeUndefined();
  });

  test("translates responseFormat json_schema", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      responseFormat: {
        type: "json_schema",
        jsonSchema: { type: "object", properties: { name: { type: "string" } } },
      },
    });

    const { body } = translateRequest(request, false);
    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { name: { type: "string" } } },
        name: "response",
        strict: true,
      },
    });
  });

  test("sets stream to true for streaming", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
    });

    const { body } = translateRequest(request, true);
    expect(body.stream).toBe(true);
  });

  test("merges providerOptions.openai into body", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      providerOptions: {
        openai: { store: true, user: "user-123" },
      },
    });

    const { body } = translateRequest(request, false);
    expect(body.store).toBe(true);
    expect(body.user).toBe("user-123");
  });

  test("translates temperature and topP", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      temperature: 0.7,
      topP: 0.9,
    });

    const { body } = translateRequest(request, false);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });

  test("translates assistant text as output_text", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.ASSISTANT,
          content: [{ kind: "text", text: "I can help with that." }],
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const input = body.input as Array<Record<string, unknown>>;

    expect(input[0]).toEqual({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "I can help with that." }],
    });
  });
});
