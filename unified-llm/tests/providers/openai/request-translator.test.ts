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
        parameters: {
          type: "object",
          properties: { city: { type: ["string", "null"] } },
          additionalProperties: false,
          required: ["city"],
        },
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

  test("M16: sets status error on tool result when isError is true", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "call_err",
                content: "Something went wrong",
                isError: true,
              },
            },
          ],
          toolCallId: "call_err",
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const input = body.input as Array<Record<string, unknown>>;

    expect(input[0]).toEqual({
      type: "function_call_output",
      call_id: "call_err",
      output: "Something went wrong",
      status: "error",
    });
  });

  test("M16: omits status when isError is false", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "call_ok",
                content: "All good",
                isError: false,
              },
            },
          ],
          toolCallId: "call_ok",
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const input = body.input as Array<Record<string, unknown>>;

    expect(input[0]).toEqual({
      type: "function_call_output",
      call_id: "call_ok",
      output: "All good",
    });
  });

  test("M17: passes through image detail field", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: "image",
              image: { url: "https://example.com/img.png", detail: "high" },
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
      image_url: "https://example.com/img.png",
      detail: "high",
    });
  });

  test("M17: omits detail when not specified", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: "image",
              image: { url: "https://example.com/img.png" },
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
      image_url: "https://example.com/img.png",
    });
  });

  test("M18: recursively enforces strict schema on nested objects", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [
        {
          name: "create_user",
          description: "Create a user",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              address: {
                type: "object",
                properties: {
                  street: { type: "string" },
                  city: { type: "string" },
                },
              },
            },
            required: ["name"],
          },
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const tools = body.tools as Array<Record<string, unknown>>;
    const firstTool = tools[0] as Record<string, unknown>;
    const params = firstTool.parameters as Record<string, unknown>;

    // Top level has additionalProperties: false
    expect(params.additionalProperties).toBe(false);
    // All keys in required
    expect(params.required).toEqual(["name", "address"]);

    // Nested object also has additionalProperties: false and required
    const props = params.properties as Record<string, Record<string, unknown>>;
    const address = props.address as Record<string, unknown>;
    expect(address.additionalProperties).toBe(false);
    expect(address.required).toEqual(["street", "city"]);
    // address was optional, so it gets nullable type
    expect(address.type).toEqual(["object", "null"]);
  });

  test("M19: encodes tool result image as data URI in output", () => {
    const imageData = new Uint8Array([137, 80, 78, 71]);
    const request = makeRequest({
      messages: [
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "call_img",
                content: "Screenshot taken",
                isError: false,
                imageData,
                imageMediaType: "image/png",
              },
            },
          ],
          toolCallId: "call_img",
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const input = body.input as Array<Record<string, unknown>>;
    const firstItem = input[0] as Record<string, unknown>;
    const output = firstItem.output as string;

    expect(output).toContain("Screenshot taken");
    expect(output).toContain("data:image/png;base64,");
  });

  test("M19: encodes tool result image without text content", () => {
    const imageData = new Uint8Array([255, 216, 255]);
    const request = makeRequest({
      messages: [
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "call_img2",
                content: "",
                isError: false,
                imageData,
                imageMediaType: "image/jpeg",
              },
            },
          ],
          toolCallId: "call_img2",
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const input = body.input as Array<Record<string, unknown>>;
    const firstItem = input[0] as Record<string, unknown>;
    const output = firstItem.output as string;

    expect(output).toMatch(/^data:image\/jpeg;base64,/);
  });

  test("maps stopSequences to stop", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      stopSequences: ["END", "STOP"],
    });

    const { body } = translateRequest(request, false);
    expect(body.stop).toEqual(["END", "STOP"]);
  });

  test("enforceStrictSchema recurses into array items with object schema", () => {
    const request = makeRequest({
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [
        {
          name: "create_users",
          description: "Create users",
          parameters: {
            type: "object",
            properties: {
              users: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    age: { type: "number" },
                  },
                },
              },
            },
          },
        },
      ],
    });

    const { body } = translateRequest(request, false);
    const tools = body.tools as Array<Record<string, unknown>>;
    const params = tools[0]?.parameters as Record<string, unknown>;
    const props = params?.properties as Record<string, Record<string, unknown>>;
    const users = props?.users as Record<string, unknown>;
    const items = users?.items as Record<string, unknown>;

    expect(items?.additionalProperties).toBe(false);
    expect(items?.required).toEqual(["name", "age"]);
  });

  test("emits warning when audio content parts are dropped", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "Listen" },
            { kind: "audio", audio: { url: "https://example.com/audio.mp3" } },
          ],
        },
      ],
    });

    const { warnings } = translateRequest(request, false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("unsupported_part");
    expect(warnings[0]?.message).toContain("Audio");
  });

  test("emits warning when document content parts are dropped", () => {
    const request = makeRequest({
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "document", document: { url: "https://example.com/doc.pdf" } },
          ],
        },
      ],
    });

    const { warnings } = translateRequest(request, false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("unsupported_part");
    expect(warnings[0]?.message).toContain("Document");
  });

  test("appends built-in tools from providerOptions", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
      providerOptions: {
        openai: {
          builtin_tools: ["web_search_preview", "file_search"],
        },
      },
    });

    const { body } = translateRequest(request, false);
    const tools = body.tools as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(3);
    expect(tools[0]?.type).toBe("function");
    expect(tools[0]?.name).toBe("get_weather");
    expect(tools[1]).toEqual({ type: "web_search_preview" });
    expect(tools[2]).toEqual({ type: "file_search" });
  });

  test("handles built-in tools without regular tools", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Search the web" }] }],
      providerOptions: {
        openai: {
          builtin_tools: ["web_search_preview"],
        },
      },
    });

    const { body } = translateRequest(request, false);
    const tools = body.tools as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({ type: "web_search_preview" });
  });

  test("handles built-in tools with object configuration", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Interpret code" }] }],
      providerOptions: {
        openai: {
          builtin_tools: [
            "code_interpreter",
            { type: "file_search", file_ids: ["file-abc123"] },
          ],
        },
      },
    });

    const { body } = translateRequest(request, false);
    const tools = body.tools as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ type: "code_interpreter" });
    expect(tools[1]).toEqual({ type: "file_search", file_ids: ["file-abc123"] });
  });

  test("ignores non-array builtin_tools", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      providerOptions: {
        openai: {
          builtin_tools: "web_search_preview",
        },
      },
    });

    const { body } = translateRequest(request, false);
    expect(body.tools).toBeUndefined();
  });

  test("filters out builtin_tools from merged providerOptions", () => {
    const request = makeRequest({
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      providerOptions: {
        openai: {
          builtin_tools: ["web_search_preview"],
          store: true,
          user: "user-123",
        },
      },
    });

    const { body } = translateRequest(request, false);

    expect(body.store).toBe(true);
    expect(body.user).toBe("user-123");
    expect(body.builtin_tools).toBeUndefined();

    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({ type: "web_search_preview" });
  });
});
