import { describe, test, expect } from "bun:test";
import { translateRequest } from "../../../src/providers/anthropic/request-translator.js";
import type { Request } from "../../../src/types/request.js";
import { Role } from "../../../src/types/role.js";

describe("Anthropic request translator", () => {
  test("translates simple text message", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hello" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.model).toBe("claude-opus-4-6");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  test("extracts system messages into system parameter", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.SYSTEM, content: [{ kind: "text", text: "Be helpful" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.system).toEqual([{ type: "text", text: "Be helpful" }]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ]);
  });

  test("merges developer messages with system", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.SYSTEM, content: [{ kind: "text", text: "System" }] },
        { role: Role.DEVELOPER, content: [{ kind: "text", text: "Dev" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.system).toEqual([
      { type: "text", text: "System" },
      { type: "text", text: "Dev" },
    ]);
  });

  test("enforces strict alternation by merging consecutive user messages", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "First" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Second" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "First" },
          { type: "text", text: "Second" },
        ],
      },
    ]);
  });

  test("translates tool definitions", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather data",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.tools).toEqual([
      {
        name: "get_weather",
        description: "Get weather data",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
        },
      },
    ]);
  });

  test("translates toolChoice auto", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "test", description: "test", parameters: {} }],
      toolChoice: { mode: "auto" },
    };

    const { body } = translateRequest(request);

    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  test("translates toolChoice none by omitting tools", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "test", description: "test", parameters: {} }],
      toolChoice: { mode: "none" },
    };

    const { body } = translateRequest(request);

    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  test("translates toolChoice required", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "test", description: "test", parameters: {} }],
      toolChoice: { mode: "required" },
    };

    const { body } = translateRequest(request);

    expect(body.tool_choice).toEqual({ type: "any" });
  });

  test("translates toolChoice named", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "get_weather", description: "test", parameters: {} }],
      toolChoice: { mode: "named", toolName: "get_weather" },
    };

    const { body } = translateRequest(request);

    expect(body.tool_choice).toEqual({ type: "tool", name: "get_weather" });
  });

  test("translates image with URL", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "image", image: { url: "https://example.com/img.png" } },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const messages = body.messages as Array<{ content: unknown[] }>;
    const firstMsg = messages.at(0);
    const firstContent = firstMsg?.content.at(0);

    expect(firstContent).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/img.png" },
    });
  });

  test("translates image with base64 data", () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: "image",
              image: { data: imageData, mediaType: "image/png" },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const source = messages.at(0)?.content.at(0)?.source as Record<string, unknown> | undefined;

    expect(source?.type).toBe("base64");
    expect(source?.media_type).toBe("image/png");
    expect(typeof source?.data).toBe("string");
  });

  test("translates thinking blocks", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "thinking",
              thinking: {
                text: "Let me think...",
                signature: "sig123",
                redacted: false,
              },
            },
            { kind: "text", text: "Here's the answer" },
          ],
        },
        { role: Role.USER, content: [{ kind: "text", text: "Thanks" }] },
      ],
    };

    const { body } = translateRequest(request);
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const firstContent = messages.at(0)?.content.at(0);

    expect(firstContent).toEqual({
      type: "thinking",
      thinking: "Let me think...",
      signature: "sig123",
    });
  });

  test("defaults max_tokens to 4096", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.max_tokens).toBe(4096);
  });

  test("uses provided max_tokens", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      maxTokens: 1024,
    };

    const { body } = translateRequest(request);

    expect(body.max_tokens).toBe(1024);
  });

  test("translates tool result messages as user role", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "What's the weather?" }] },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "get_weather", arguments: { city: "NYC" } },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: { toolCallId: "tc1", content: "72F", isError: false },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const toolMsg = messages.at(2);

    expect(toolMsg?.role).toBe("user");
    expect(toolMsg?.content.at(0)).toEqual({
      type: "tool_result",
      tool_use_id: "tc1",
      content: "72F",
      is_error: false,
    });
  });

  test("passes temperature, topP, and stopSequences", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      temperature: 0.7,
      topP: 0.9,
      stopSequences: ["END"],
    };

    const { body } = translateRequest(request);

    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.stop_sequences).toEqual(["END"]);
  });

  test("passes metadata through", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [{ role: Role.USER, content: [{ kind: "text", text: "Hi" }] }],
      metadata: { traceId: "trace-123", tenant: "acme" },
    };

    const { body } = translateRequest(request);
    expect(body.metadata).toEqual({ traceId: "trace-123", tenant: "acme" });
  });

  test("passes thinking provider option through", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budget_tokens: 5000 },
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  test("returns beta headers from provider options", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          betaHeaders: "prompt-caching-2024-07-31",
        },
      },
    };

    const { headers } = translateRequest(request);

    expect(headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
  });

  test("joins array betaHeaders with commas", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          betaHeaders: ["prompt-caching-2024-07-31", "extended-thinking-2025-01-24"],
        },
      },
    };

    const { headers } = translateRequest(request);

    expect(headers["anthropic-beta"]).toBe(
      "prompt-caching-2024-07-31,extended-thinking-2025-01-24",
    );
  });

  test("passes unknown providerOptions keys through to body", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          metadata: { user_id: "u123" },
          top_k: 5,
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.metadata).toEqual({ user_id: "u123" });
    expect(body.top_k).toBe(5);
  });

  test("does not pass known providerOptions keys to body", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budget_tokens: 5000 },
          betaHeaders: "some-beta",
          autoCache: false,
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
    expect(body.betaHeaders).toBeUndefined();
    expect(body.autoCache).toBeUndefined();
  });

  test("injects JSON schema instructions into system for json_schema responseFormat", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "json_schema", jsonSchema: schema },
    };

    const { body } = translateRequest(request);
    const system = body.system as Array<Record<string, unknown>>;

    expect(system).toHaveLength(1);
    const text = system.at(0)?.text;
    expect(typeof text).toBe("string");
    expect(text).toContain("Respond with valid JSON matching this schema:");
    expect(text).toContain('"name"');
  });

  test("appends JSON schema instructions after existing system blocks", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.SYSTEM, content: [{ kind: "text", text: "Be helpful" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "json_schema", jsonSchema: { type: "object" } },
    };

    const { body } = translateRequest(request);
    const system = body.system as Array<Record<string, unknown>>;

    expect(system).toHaveLength(2);
    expect(system.at(0)?.text).toBe("Be helpful");
    expect(system.at(1)?.text).toContain("Respond with valid JSON");
  });

  test("injects plain JSON instruction for json responseFormat", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "json" },
    };

    const { body } = translateRequest(request);
    const system = body.system as Array<Record<string, unknown>>;

    expect(system).toHaveLength(1);
    expect(system.at(0)?.text).toBe("Respond with valid JSON.");
  });

  test("does not inject system for text responseFormat", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "text" },
    };

    const { body } = translateRequest(request);

    expect(body.system).toBeUndefined();
  });

  test("translates tool result with image data", () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Screenshot?" }] },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "screenshot", arguments: {} },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: {
                toolCallId: "tc1",
                content: "Here is the screenshot",
                isError: false,
                imageData: imageBytes,
                imageMediaType: "image/jpeg",
              },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const messages = body.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const toolMsg = messages.at(2);
    const toolResult = toolMsg?.content.at(0);

    expect(toolResult?.type).toBe("tool_result");
    const content = toolResult?.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content.at(0)?.type).toBe("text");
    expect(content.at(0)?.text).toBe("Here is the screenshot");
    expect(content.at(1)?.type).toBe("image");
    const source = content.at(1)?.source as Record<string, unknown>;
    expect(source?.type).toBe("base64");
    expect(source?.media_type).toBe("image/jpeg");
    expect(typeof source?.data).toBe("string");
  });

  test("translates redacted thinking blocks", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "redacted_thinking",
              thinking: { text: "redacted-data", redacted: true },
            },
          ],
        },
        { role: Role.USER, content: [{ kind: "text", text: "Ok" }] },
      ],
    };

    const { body } = translateRequest(request);
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    const firstContent = messages.at(0)?.content.at(0);

    expect(firstContent).toEqual({
      type: "redacted_thinking",
      data: "redacted-data",
    });
  });

  test("accepts snake_case beta_headers provider option", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          beta_headers: "prompt-caching-2024-07-31",
        },
      },
    };

    const { headers } = translateRequest(request);

    expect(headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
  });

  test("prefers snake_case beta_headers over camelCase", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          beta_headers: "from-snake",
          betaHeaders: "from-camel",
        },
      },
    };

    const { headers } = translateRequest(request);

    expect(headers["anthropic-beta"]).toBe("from-snake");
  });

  test("excludes snake_case known keys from passthrough", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        anthropic: {
          auto_cache: false,
          beta_headers: "some-beta",
          custom_field: "value",
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.auto_cache).toBeUndefined();
    expect(body.beta_headers).toBeUndefined();
    expect(body.custom_field).toBe("value");
  });

  test("emits warning when audio content parts are dropped", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "Listen to this" },
            { kind: "audio", audio: { url: "https://example.com/audio.mp3" } },
          ],
        },
      ],
    };

    const { warnings, body } = translateRequest(request);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("unsupported_part");
    expect(warnings[0]?.message).toContain("Audio");
    // Text part should still be translated
    const messages = body.messages as Array<{ content: unknown[] }>;
    expect(messages[0]?.content).toHaveLength(1);
  });

  test("emits warning when document content parts are dropped", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "document", document: { url: "https://example.com/doc.pdf" } },
          ],
        },
      ],
    };

    const { warnings } = translateRequest(request);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("unsupported_part");
    expect(warnings[0]?.message).toContain("Document");
  });
});
