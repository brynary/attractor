import { describe, test, expect } from "bun:test";
import { translateRequest } from "../../../src/providers/gemini/request-translator.js";
import type { Request } from "../../../src/types/request.js";
import { Role } from "../../../src/types/role.js";

describe("Gemini request translator", () => {
  test("translates simple text message", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hello" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
    ]);
  });

  test("extracts system messages into systemInstruction", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.SYSTEM, content: [{ kind: "text", text: "Be helpful" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.systemInstruction).toEqual({
      parts: [{ text: "Be helpful" }],
    });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Hi" }] },
    ]);
  });

  test("merges developer messages with system", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.SYSTEM, content: [{ kind: "text", text: "System" }] },
        { role: Role.DEVELOPER, content: [{ kind: "text", text: "Dev" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.systemInstruction).toEqual({
      parts: [{ text: "System" }, { text: "Dev" }],
    });
  });

  test("maps assistant role to model", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
        { role: Role.ASSISTANT, content: [{ kind: "text", text: "Hello!" }] },
        { role: Role.USER, content: [{ kind: "text", text: "Thanks" }] },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ role: string }>;

    expect(contents.at(0)?.role).toBe("user");
    expect(contents.at(1)?.role).toBe("model");
    expect(contents.at(2)?.role).toBe("user");
  });

  test("maps tool role to user", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Weather?" }] },
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
    const contents = body.contents as Array<{ role: string }>;

    expect(contents.at(2)?.role).toBe("user");
  });

  test("translates text content parts", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "First" },
            { kind: "text", text: "Second" },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: unknown[] }>;

    expect(contents.at(0)?.parts).toEqual([
      { text: "First" },
      { text: "Second" },
    ]);
  });

  test("translates image with URL to fileData", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: "image",
              image: { url: "https://example.com/img.png", mediaType: "image/png" },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;

    expect(contents.at(0)?.parts.at(0)).toEqual({
      fileData: {
        mimeType: "image/png",
        fileUri: "https://example.com/img.png",
      },
    });
  });

  test("translates image with data to inlineData", () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const request: Request = {
      model: "gemini-3-pro-preview",
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
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    const part = contents.at(0)?.parts.at(0);
    const inlineData = part?.inlineData as Record<string, unknown> | undefined;

    expect(inlineData?.mimeType).toBe("image/png");
    expect(typeof inlineData?.data).toBe("string");
  });

  test("translates tool_call to functionCall", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "get_weather", arguments: { city: "NYC" } },
            },
          ],
        },
        { role: Role.USER, content: [{ kind: "text", text: "ok" }] },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;

    expect(contents.at(0)?.parts.at(0)).toEqual({
      functionCall: {
        name: "get_weather",
        args: { city: "NYC" },
      },
    });
  });

  test("handles invalid JSON tool call arguments without throwing", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: {
                id: "tc_bad",
                name: "get_weather",
                arguments: "{bad-json",
              },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;

    expect(contents.at(0)?.parts.at(0)).toEqual({
      functionCall: {
        name: "get_weather",
        args: {},
      },
    });
  });

  test("translates tool_result to functionResponse", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Weather?" }] },
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
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;

    expect(contents.at(2)?.parts.at(0)).toEqual({
      functionResponse: {
        name: "get_weather",
        response: { result: "72F" },
      },
    });
  });

  test("wraps string tool results in result object", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Do it" }] },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "run", arguments: {} },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: { toolCallId: "tc1", content: "done", isError: false },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    const part = contents.at(2)?.parts.at(0);
    const functionResponse = part?.functionResponse as Record<string, unknown> | undefined;

    expect(functionResponse?.response).toEqual({ result: "done" });
  });

  test("wraps error tool result in error object", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Do it" }] },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "run", arguments: {} },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: { toolCallId: "tc1", content: "file not found", isError: true },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    const part = contents.at(2)?.parts.at(0);
    const functionResponse = part?.functionResponse as Record<string, unknown> | undefined;

    expect(functionResponse?.response).toEqual({ error: "file not found" });
  });

  test("passes object tool results directly", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Do it" }] },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "run", arguments: {} },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: "tool_result",
              toolResult: { toolCallId: "tc1", content: { status: "ok" }, isError: false },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    const part = contents.at(2)?.parts.at(0);
    const functionResponse = part?.functionResponse as Record<string, unknown> | undefined;

    expect(functionResponse?.response).toEqual({ status: "ok" });
  });

  test("translates tool definitions to functionDeclarations", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
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
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get weather data",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
            },
          },
        ],
      },
    ]);
  });

  test("translates toolChoice auto", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "test", description: "test", parameters: {} }],
      toolChoice: { mode: "auto" },
    };

    const { body } = translateRequest(request);

    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });
  });

  test("translates toolChoice none — sends tools with NONE config", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "test", description: "test", parameters: {} }],
      toolChoice: { mode: "none" },
    };

    const { body } = translateRequest(request);

    expect(body.tools).toEqual([
      { functionDeclarations: [{ name: "test", description: "test", parameters: {} }] },
    ]);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "NONE" },
    });
  });

  test("translates toolChoice required", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "test", description: "test", parameters: {} }],
      toolChoice: { mode: "required" },
    };

    const { body } = translateRequest(request);

    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
  });

  test("translates toolChoice named", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      tools: [{ name: "get_weather", description: "test", parameters: {} }],
      toolChoice: { mode: "named", toolName: "get_weather" },
    };

    const { body } = translateRequest(request);

    expect(body.toolConfig).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["get_weather"],
      },
    });
  });

  test("sets generation config for temperature, topP, maxOutputTokens, stopSequences", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 1024,
      stopSequences: ["END"],
    };

    const { body } = translateRequest(request);

    expect(body.generationConfig).toEqual({
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1024,
      stopSequences: ["END"],
    });
  });

  test("sets responseMimeType and responseSchema for json_schema responseFormat", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "json_schema", jsonSchema: schema },
    };

    const { body } = translateRequest(request);
    const generationConfig = body.generationConfig as Record<string, unknown>;

    expect(generationConfig.responseMimeType).toBe("application/json");
    expect(generationConfig.responseSchema).toEqual(schema);
  });

  test("sets responseMimeType for json responseFormat", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "json" },
    };

    const { body } = translateRequest(request);
    const generationConfig = body.generationConfig as Record<string, unknown>;

    expect(generationConfig.responseMimeType).toBe("application/json");
  });

  test("does not set generationConfig for text responseFormat", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      responseFormat: { type: "text" },
    };

    const { body } = translateRequest(request);

    expect(body.generationConfig).toBeUndefined();
  });

  test("passes thinkingConfig from provider options", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        gemini: {
          thinkingConfig: { thinkingBudget: 5000 },
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.thinkingConfig).toEqual({ thinkingBudget: 5000 });
  });

  test("passes unknown providerOptions keys through to body", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        gemini: {
          safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }],
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.safetySettings).toEqual([
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    ]);
  });

  test("does not pass known providerOptions keys to body as duplicates", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hi" }] },
      ],
      providerOptions: {
        gemini: {
          thinkingConfig: { thinkingBudget: 5000 },
        },
      },
    };

    const { body } = translateRequest(request);

    expect(body.thinkingConfig).toEqual({ thinkingBudget: 5000 });
  });

  test("translates thinking blocks", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "thinking",
              thinking: { text: "Let me think...", redacted: false },
            },
            { kind: "text", text: "Here's the answer" },
          ],
        },
        { role: Role.USER, content: [{ kind: "text", text: "Thanks" }] },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;

    expect(contents.at(0)?.parts.at(0)).toEqual({ thought: true, text: "Let me think..." });
    expect(contents.at(0)?.parts.at(1)).toEqual({ text: "Here's the answer" });
  });

  test("returns toolCallIdMap with tool call IDs", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: { id: "tc1", name: "get_weather", arguments: {} },
            },
          ],
        },
        { role: Role.USER, content: [{ kind: "text", text: "ok" }] },
      ],
    };

    const { toolCallIdMap } = translateRequest(request);

    expect(toolCallIdMap.get("tc1")).toBe("get_weather");
  });

  test("translates tool result with image data as inlineData part", () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Analyze" }] },
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
                content: "screenshot taken",
                isError: false,
                imageData: imageBytes,
                imageMediaType: "image/png",
              },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    const toolParts = contents.at(2)?.parts;

    expect(toolParts).toHaveLength(2);
    expect(toolParts?.at(0)).toEqual({
      functionResponse: {
        name: "screenshot",
        response: { result: "screenshot taken" },
      },
    });
    const inlineData = toolParts?.at(1)?.inlineData as Record<string, unknown> | undefined;
    expect(inlineData?.mimeType).toBe("image/png");
    expect(typeof inlineData?.data).toBe("string");
  });

  test("emits warning for audio content parts", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "Listen" },
            { kind: "audio", audio: { data: new Uint8Array([1, 2]), mediaType: "audio/wav" } },
          ],
        },
      ],
    };

    const { warnings } = translateRequest(request);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("Audio");
  });

  test("emits warning for document content parts", () => {
    const request: Request = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: "text", text: "Read this" },
            { kind: "document", document: { data: new Uint8Array([1]), mediaType: "application/pdf" } },
          ],
        },
      ],
    };

    const { warnings } = translateRequest(request);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("Document");
  });
});
