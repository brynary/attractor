import { describe, test, expect } from "bun:test";
import {
  generateObject,
  generateObjectWithJsonSchema,
} from "../../src/api/generate-object.js";
import { Client } from "../../src/client/client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { Response } from "../../src/types/response.js";
import { Role } from "../../src/types/role.js";
import { NoObjectGeneratedError } from "../../src/types/errors.js";

function makeToolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
): Response {
  return {
    id: "resp-1",
    model: "test-model",
    provider: "stub",
    message: {
      role: Role.ASSISTANT,
      content: [
        {
          kind: "tool_call",
          toolCall: { id: "tc-1", name: toolName, arguments: args },
        },
      ],
    },
    finishReason: { reason: "tool_calls" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

function makeTextResponse(text: string): Response {
  return {
    id: "resp-1",
    model: "test-model",
    provider: "stub",
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: "text", text }],
    },
    finishReason: { reason: "stop" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

describe("generateObject (tool extraction)", () => {
  function makeClient(adapter: StubAdapter): Client {
    return new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });
  }

  test("extracts structured data via tool call", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeToolCallResponse("extract", {
          name: "Alice",
          age: 30,
        }),
      },
    ]);
    const client = makeClient(adapter);

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract person info from: Alice is 30 years old",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      client,
    });

    expect(result.output).toEqual({ name: "Alice", age: 30 });
  });

  test("uses custom schema name", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeToolCallResponse("person", { name: "Bob" }),
      },
    ]);
    const client = makeClient(adapter);

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object", properties: { name: { type: "string" } } },
      schemaName: "person",
      client,
    });

    expect(result.output).toEqual({ name: "Bob" });

    // Verify the tool was named "person"
    const sentRequest = adapter.calls[0];
    expect(sentRequest?.tools?.[0]?.name).toBe("person");
  });

  test("throws NoObjectGeneratedError when no tool call", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse("I can't extract that") },
    ]);
    const client = makeClient(adapter);

    await expect(
      generateObject({
        model: "test-model",
        prompt: "Extract",
        schema: { type: "object" },
        client,
      }),
    ).rejects.toThrow(NoObjectGeneratedError);
  });

  test("forces tool choice to named extract tool", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeToolCallResponse("extract", { value: 42 }),
      },
    ]);
    const client = makeClient(adapter);

    await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object" },
      client,
    });

    const sentRequest = adapter.calls[0];
    expect(sentRequest?.toolChoice).toEqual({
      mode: "named",
      toolName: "extract",
    });
  });
});

describe("generateObjectWithJsonSchema", () => {
  function makeClient(adapter: StubAdapter): Client {
    return new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });
  }

  test("uses json_schema response format", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeTextResponse('{"name": "Alice", "age": 30}'),
      },
    ]);
    const client = makeClient(adapter);

    const result = await generateObjectWithJsonSchema({
      model: "test-model",
      prompt: "Extract person",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      client,
    });

    expect(result.output).toEqual({ name: "Alice", age: 30 });

    // Verify response format was set
    const sentRequest = adapter.calls[0];
    expect(sentRequest?.responseFormat).toEqual({
      type: "json_schema",
      jsonSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      strict: true,
    });
  });

  test("throws NoObjectGeneratedError on invalid JSON", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse("not valid json") },
    ]);
    const client = makeClient(adapter);

    await expect(
      generateObjectWithJsonSchema({
        model: "test-model",
        prompt: "Extract",
        schema: { type: "object" },
        client,
      }),
    ).rejects.toThrow(NoObjectGeneratedError);
  });
});

describe("generateObject strategy dispatch", () => {
  test("auto strategy uses json_schema when adapter supports it", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse('{"name": "Alice"}') },
    ]);
    Object.assign(adapter, { supportsNativeJsonSchema: true });

    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object", properties: { name: { type: "string" } } },
      client,
    });

    expect(result.output).toEqual({ name: "Alice" });
    const sentRequest = adapter.calls[0];
    expect(sentRequest?.responseFormat).toBeDefined();
    expect(sentRequest?.tools).toBeUndefined();
  });

  test("auto strategy uses tool when adapter lacks supportsNativeJsonSchema", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { name: "Bob" }) },
    ]);

    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object", properties: { name: { type: "string" } } },
      client,
    });

    expect(result.output).toEqual({ name: "Bob" });
    const sentRequest = adapter.calls[0];
    expect(sentRequest?.tools).toBeDefined();
  });

  test("explicit tool strategy overrides auto", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { val: 1 }) },
    ]);
    Object.assign(adapter, { supportsNativeJsonSchema: true });

    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object" },
      strategy: "tool",
      client,
    });

    expect(result.output).toEqual({ val: 1 });
    const sentRequest = adapter.calls[0];
    expect(sentRequest?.tools).toBeDefined();
  });
});
