import { describe, test, expect } from "bun:test";
import { generate, stream, generateObject, StreamEventType } from "../../src/index.js";
import { Client } from "../../src/client/client.js";
import { AnthropicAdapter } from "../../src/providers/anthropic/index.js";
import { OpenAIAdapter } from "../../src/providers/openai/index.js";
import { setDefaultClient } from "../../src/client/default-client.js";

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const openaiKey = process.env["OPENAI_API_KEY"];

const hasAnthropic = !!anthropicKey;
const hasOpenAI = !!openaiKey;

function setupClient() {
  const providers: Record<string, AnthropicAdapter | OpenAIAdapter> = {};
  if (anthropicKey) {
    providers["anthropic"] = new AnthropicAdapter({ apiKey: anthropicKey });
  }
  if (openaiKey) {
    providers["openai"] = new OpenAIAdapter({ apiKey: openaiKey });
  }
  const client = new Client({ providers });
  setDefaultClient(client);
  return client;
}

const client = setupClient();

// ── Anthropic Tests ──

describe.skipIf(!hasAnthropic)("Anthropic E2E", () => {
  test("simple generation", async () => {
    const result = await generate({
      model: "claude-sonnet-4-5-20250929",
      prompt: "Say hello in exactly 3 words.",
      maxTokens: 50,
      provider: "anthropic",
      client,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.finishReason.reason).toBe("stop");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    console.log(`  Anthropic gen: "${result.text}" (${result.usage.totalTokens} tokens)`);
  }, 30000);

  test("streaming", async () => {
    const result = stream({
      model: "claude-sonnet-4-5-20250929",
      prompt: "Count from 1 to 5, one number per line.",
      maxTokens: 100,
      provider: "anthropic",
      client,
    });

    const chunks: string[] = [];
    let sawStart = false;
    let sawFinish = false;

    for await (const event of result) {
      if (event.type === StreamEventType.STREAM_START) sawStart = true;
      if (event.type === StreamEventType.TEXT_DELTA) chunks.push(event.text);
      if (event.type === StreamEventType.FINISH) sawFinish = true;
    }

    const fullText = chunks.join("");
    expect(sawStart).toBe(true);
    expect(sawFinish).toBe(true);
    expect(fullText.length).toBeGreaterThan(0);
    expect(fullText).toContain("1");
    expect(fullText).toContain("5");
    console.log(`  Anthropic stream: ${chunks.length} chunks, ${fullText.length} chars`);

    const response = await result.response();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  }, 30000);

  test("tool calling", async () => {
    const result = await generate({
      model: "claude-sonnet-4-5-20250929",
      prompt: "What is the weather in Tokyo?",
      maxTokens: 200,
      provider: "anthropic",
      client,
      tools: [
        {
          name: "get_weather",
          description: "Get the current weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
            },
            required: ["city"],
          },
          execute: async (args: Record<string, unknown>) => {
            return `25°C and sunny in ${args["city"]}`;
          },
        },
      ],
      maxToolRounds: 3,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.toLowerCase()).toContain("tokyo");
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.totalUsage.totalTokens).toBeGreaterThan(result.usage.totalTokens);
    console.log(`  Anthropic tools: ${result.steps.length} steps, "${result.text.slice(0, 80)}..."`);
  }, 60000);

  test("structured output (tool extraction)", async () => {
    const result = await generateObject({
      model: "claude-sonnet-4-5-20250929",
      prompt: "Extract: Alice is 30 years old and lives in Portland.",
      maxTokens: 200,
      provider: "anthropic",
      client,
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
          city: { type: "string" },
        },
        required: ["name", "age", "city"],
      },
    });

    expect(result.output).toBeTruthy();
    const output = result.output as Record<string, unknown>;
    expect(output["name"]).toBe("Alice");
    expect(output["age"]).toBe(30);
    expect(output["city"]).toBe("Portland");
    console.log(`  Anthropic structured: ${JSON.stringify(result.output)}`);
  }, 30000);

  test("error handling (invalid model)", async () => {
    try {
      await generate({
        model: "nonexistent-model-xyz",
        prompt: "test",
        provider: "anthropic",
        client,
        maxRetries: 0,
      });
      expect(true).toBe(false); // should not reach here
    } catch (error) {
      expect(error).toBeTruthy();
      console.log(`  Anthropic error: ${(error as Error).constructor.name}: ${(error as Error).message.slice(0, 80)}`);
    }
  }, 15000);
});

// ── OpenAI Tests ──

describe.skipIf(!hasOpenAI)("OpenAI E2E", () => {
  test("simple generation", async () => {
    const result = await generate({
      model: "gpt-4.1-nano",
      prompt: "Say hello in exactly 3 words.",
      maxTokens: 50,
      provider: "openai",
      client,
    });

    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.finishReason.reason).toBe("stop");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    console.log(`  OpenAI gen: "${result.text}" (${result.usage.totalTokens} tokens)`);
  }, 30000);

  test("streaming", async () => {
    const result = stream({
      model: "gpt-4.1-nano",
      prompt: "Count from 1 to 5, one number per line.",
      maxTokens: 100,
      provider: "openai",
      client,
    });

    const chunks: string[] = [];
    let sawStart = false;
    let sawFinish = false;

    for await (const event of result) {
      if (event.type === StreamEventType.STREAM_START) sawStart = true;
      if (event.type === StreamEventType.TEXT_DELTA) chunks.push(event.text);
      if (event.type === StreamEventType.FINISH) sawFinish = true;
    }

    const fullText = chunks.join("");
    expect(sawStart).toBe(true);
    expect(sawFinish).toBe(true);
    expect(fullText.length).toBeGreaterThan(0);
    expect(fullText).toContain("1");
    console.log(`  OpenAI stream: ${chunks.length} chunks, ${fullText.length} chars`);
  }, 30000);

  test("tool calling", async () => {
    const result = await generate({
      model: "gpt-4.1-nano",
      prompt: "What is the weather in Tokyo?",
      maxTokens: 200,
      provider: "openai",
      client,
      tools: [
        {
          name: "get_weather",
          description: "Get the current weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
            },
            required: ["city"],
          },
          execute: async (args: Record<string, unknown>) => {
            return `25°C and sunny in ${args["city"]}`;
          },
        },
      ],
      maxToolRounds: 3,
    });

    expect(result.text).toBeTruthy();
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    console.log(`  OpenAI tools: ${result.steps.length} steps, "${result.text.slice(0, 80)}..."`);
  }, 60000);

  test("error handling (invalid model)", async () => {
    try {
      await generate({
        model: "nonexistent-model-xyz",
        prompt: "test",
        provider: "openai",
        client,
        maxRetries: 0,
      });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeTruthy();
      console.log(`  OpenAI error: ${(error as Error).constructor.name}: ${(error as Error).message.slice(0, 80)}`);
    }
  }, 15000);
});

// ── Cross-Provider Tests ──

describe.skipIf(!hasAnthropic || !hasOpenAI)("Cross-Provider E2E", () => {
  test("same prompt, different providers", async () => {
    const prompt = "What is 2 + 2? Answer with just the number.";

    const [anthropicResult, openaiResult] = await Promise.all([
      generate({ model: "claude-sonnet-4-5-20250929", prompt, maxTokens: 50, provider: "anthropic", client }),
      generate({ model: "gpt-4.1-nano", prompt, maxTokens: 50, provider: "openai", client }),
    ]);

    expect(anthropicResult.text).toContain("4");
    expect(openaiResult.text).toContain("4");
    console.log(`  Anthropic: "${anthropicResult.text.trim()}" | OpenAI: "${openaiResult.text.trim()}"`);
  }, 30000);

  test("provider fallback pattern", async () => {
    let result;
    try {
      result = await generate({
        model: "nonexistent-model",
        prompt: "Hello",
        provider: "anthropic",
        client,
        maxRetries: 0,
      });
    } catch {
      // Fallback to OpenAI
      result = await generate({
        model: "gpt-4.1-nano",
        prompt: "Hello",
        provider: "openai",
        client,
      });
    }
    expect(result.text).toBeTruthy();
    console.log(`  Fallback: ${result.response.provider} responded: "${result.text.slice(0, 50)}..."`);
  }, 30000);
});
