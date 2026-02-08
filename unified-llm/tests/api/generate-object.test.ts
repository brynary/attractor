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

  test("throws NoObjectGeneratedError when no tool call after all retries", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse("I can't extract that") },
      { response: makeTextResponse("Still can't") },
      { response: makeTextResponse("Nope") },
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

    // Verify 3 calls were made (1 initial + 2 retries)
    expect(adapter.calls.length).toBe(3);
  });

  test("throws NoObjectGeneratedError when tool call arguments don't match schema after all retries", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { name: 123 }) },
      { response: makeToolCallResponse("extract", { name: 456 }) },
      { response: makeToolCallResponse("extract", { name: 789 }) },
    ]);
    const client = makeClient(adapter);

    await expect(
      generateObject({
        model: "test-model",
        prompt: "Extract",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        client,
      }),
    ).rejects.toThrow(NoObjectGeneratedError);

    expect(adapter.calls.length).toBe(3);
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

  test("throws NoObjectGeneratedError when JSON doesn't match schema after all retries", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse('{"name": 123}') },
      { response: makeTextResponse('{"name": 456}') },
      { response: makeTextResponse('{"name": 789}') },
    ]);
    const client = makeClient(adapter);

    await expect(
      generateObjectWithJsonSchema({
        model: "test-model",
        prompt: "Extract",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        client,
      }),
    ).rejects.toThrow(NoObjectGeneratedError);

    expect(adapter.calls.length).toBe(3);
  });

  test("throws NoObjectGeneratedError on invalid JSON after all retries", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse("not valid json") },
      { response: makeTextResponse("still not json") },
      { response: makeTextResponse("nope") },
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

    expect(adapter.calls.length).toBe(3);
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

describe("generateObject retry-with-feedback (Gap 1)", () => {
  function makeClient(adapter: StubAdapter): Client {
    return new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });
  }

  test("retries on validation failure and succeeds on second attempt (tool strategy)", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { name: 123 }) },
      { response: makeToolCallResponse("extract", { name: "Alice" }) },
    ]);
    const client = makeClient(adapter);

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      client,
    });

    expect(result.output).toEqual({ name: "Alice" });
    expect(adapter.calls.length).toBe(2);
  });

  test("retries on validation failure and succeeds on second attempt (json_schema strategy)", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeTextResponse('{"name": 123}') },
      { response: makeTextResponse('{"name": "Bob"}') },
    ]);
    Object.assign(adapter, { supportsNativeJsonSchema: true });

    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    const result = await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      client,
    });

    expect(result.output).toEqual({ name: "Bob" });
    expect(adapter.calls.length).toBe(2);
  });

  test("retry messages include validation error feedback", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { name: 123 }) },
      { response: makeToolCallResponse("extract", { name: "Alice" }) },
    ]);
    const client = makeClient(adapter);

    await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      client,
    });

    // Second call should contain the validation error feedback message
    const secondRequest = adapter.calls[1];
    const lastMessage =
      secondRequest?.messages[secondRequest.messages.length - 1];
    expect(lastMessage?.role).toBe("user");

    // The feedback message should mention schema mismatch
    const textPart = lastMessage?.content[0];
    expect(textPart?.kind).toBe("text");
    if (textPart?.kind === "text") {
      expect(textPart.text).toContain("did not match the schema");
    }
  });

  test("maxValidationRetries: 0 throws immediately on first failure", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { name: 123 }) },
    ]);
    const client = makeClient(adapter);

    await expect(
      generateObject({
        model: "test-model",
        prompt: "Extract",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        maxValidationRetries: 0,
        client,
      }),
    ).rejects.toThrow(NoObjectGeneratedError);

    expect(adapter.calls.length).toBe(1);
  });

  test("custom maxValidationRetries is respected", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeToolCallResponse("extract", { name: 1 }) },
      { response: makeToolCallResponse("extract", { name: 2 }) },
      { response: makeToolCallResponse("extract", { name: 3 }) },
      { response: makeToolCallResponse("extract", { name: 4 }) },
      { response: makeToolCallResponse("extract", { name: 5 }) },
    ]);
    const client = makeClient(adapter);

    await expect(
      generateObject({
        model: "test-model",
        prompt: "Extract",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        maxValidationRetries: 4,
        client,
      }),
    ).rejects.toThrow(NoObjectGeneratedError);

    // 1 initial + 4 retries = 5 calls
    expect(adapter.calls.length).toBe(5);
  });

  test("timeout config passed to adapter", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeToolCallResponse("extract", { name: "Alice" }),
      },
    ]);
    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    await generateObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      timeout: 15000,
      client,
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toBeDefined();
    expect(adapter.calls[0]?.timeout?.request).toBe(15000);
    expect(adapter.calls[0]?.timeout?.connect).toBe(10_000);
  });
});
