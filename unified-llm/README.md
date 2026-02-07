# unified-llm

A unified LLM client library that provides a single interface across Anthropic and OpenAI. Write provider-agnostic code and switch models by changing a string.

Each adapter uses the provider's **native API** (Anthropic Messages API, OpenAI Responses API) — not compatibility shims — so you get full access to reasoning tokens, prompt caching, extended thinking, and other provider-specific features.

## Setup

```bash
bun install
```

Set one or both API keys:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

## Quick Start

```typescript
import { generate } from "unified-llm";

const result = await generate({
  model: "claude-opus-4-6",
  prompt: "Explain photosynthesis in one paragraph.",
});

console.log(result.text);
console.log(result.usage.totalTokens);
```

The library auto-configures from environment variables. The first provider key found becomes the default.

## Generation

### Simple prompt

```typescript
import { generate } from "unified-llm";

const result = await generate({
  model: "gpt-5.2",
  prompt: "What is the capital of France?",
  provider: "openai",
});

console.log(result.text);           // "The capital of France is Paris."
console.log(result.finishReason);   // { reason: "stop", raw: "completed" }
```

### System message + conversation history

```typescript
import { generate, systemMessage, userMessage, assistantMessage } from "unified-llm";

const result = await generate({
  model: "claude-sonnet-4-5",
  system: "You are a helpful math tutor.",
  messages: [
    userMessage("What is 2 + 2?"),
    assistantMessage("4"),
    userMessage("What about 3 + 3?"),
  ],
});
```

### Generation parameters

```typescript
const result = await generate({
  model: "claude-opus-4-6",
  prompt: "Write a creative haiku.",
  temperature: 0.9,
  maxTokens: 100,
  maxRetries: 3,
});
```

## Streaming

```typescript
import { stream, StreamEventType } from "unified-llm";

const result = stream({
  model: "claude-opus-4-6",
  prompt: "Write a short story about a robot.",
});

// Option 1: iterate over all events
for await (const event of result) {
  if (event.type === StreamEventType.TEXT_DELTA) {
    process.stdout.write(event.text);
  }
}

// Option 2: use textStream() for just the text
const result2 = stream({
  model: "claude-opus-4-6",
  prompt: "Write a poem.",
});

for await (const chunk of result2.textStream()) {
  process.stdout.write(chunk);
}

// Get the full response after streaming completes
const response = await result2.response();
console.log(response.usage);
```

## Tool Calling

Define tools with `execute` handlers and the library runs the tool loop automatically.

```typescript
import { generate } from "unified-llm";

const weatherTool = {
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City name" },
    },
    required: ["location"],
  },
  execute: async (args: Record<string, unknown>) => {
    // Call your weather API here
    return `72F and sunny in ${args["location"]}`;
  },
};

const result = await generate({
  model: "claude-opus-4-6",
  prompt: "What's the weather in San Francisco and New York?",
  tools: [weatherTool],
  maxToolRounds: 5,
});

console.log(result.text);
// "The weather in San Francisco is 72F and sunny, and in New York..."

console.log(result.steps.length);
// 2 (initial call + after tool results)

console.log(result.totalUsage);
// Aggregated token usage across all steps
```

Multiple tool calls in a single response are executed concurrently via `Promise.all`.

### Passive tools (no auto-execution)

Omit the `execute` handler to get tool calls back without automatic execution:

```typescript
const result = await generate({
  model: "claude-opus-4-6",
  prompt: "What's the weather?",
  tools: [{ name: "get_weather", description: "...", parameters: { ... } }],
  maxToolRounds: 0,
});

// Handle tool calls yourself
for (const tc of result.toolCalls) {
  console.log(tc.name, tc.arguments);
}
```

## Structured Output

### generateObject — tool extraction (works with all providers)

```typescript
import { generateObject } from "unified-llm";

const result = await generateObject({
  model: "claude-opus-4-6",
  prompt: "Extract: Alice is 30 years old and lives in Portland.",
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

console.log(result.output);
// { name: "Alice", age: 30, city: "Portland" }
```

### generateObjectWithJsonSchema — native JSON schema (OpenAI)

```typescript
import { generateObjectWithJsonSchema } from "unified-llm";

const result = await generateObjectWithJsonSchema({
  model: "gpt-5.2",
  provider: "openai",
  prompt: "Extract: Bob is 25.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
    },
    required: ["name", "age"],
  },
});

console.log(result.output);
// { name: "Bob", age: 25 }
```

### Streaming structured output

```typescript
import { streamObject } from "unified-llm";

for await (const partial of streamObject({
  model: "claude-opus-4-6",
  prompt: "List 3 recipes with name and ingredients.",
  schema: {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            ingredients: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
})) {
  console.log("Partial:", partial);
  // Progressive updates as JSON forms
}
```

## Client Configuration

### Auto-configure from environment

```typescript
import { Client, setDefaultClient } from "unified-llm";

// Happens automatically on first generate/stream call:
const client = Client.fromEnv();
// Reads ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
```

### Manual configuration

```typescript
import { Client, AnthropicAdapter, OpenAIAdapter, setDefaultClient } from "unified-llm";

const client = new Client({
  providers: {
    anthropic: new AnthropicAdapter({ apiKey: "sk-ant-..." }),
    openai: new OpenAIAdapter({
      apiKey: "sk-...",
      orgId: "org-...",
    }),
  },
  defaultProvider: "anthropic",
});

setDefaultClient(client);
```

### Per-call client override

```typescript
import { generate, Client, AnthropicAdapter } from "unified-llm";

const customClient = new Client({
  providers: {
    anthropic: new AnthropicAdapter({
      apiKey: "sk-ant-...",
      baseUrl: "https://custom-proxy.example.com",
    }),
  },
});

const result = await generate({
  model: "claude-opus-4-6",
  prompt: "Hello",
  client: customClient,
});
```

## Middleware

```typescript
import { Client, AnthropicAdapter } from "unified-llm";
import type { Middleware } from "unified-llm";

const logging: Middleware = async (request, next) => {
  const start = performance.now();
  console.log(`LLM request: ${request.model}`);
  const response = await next(request);
  console.log(`LLM response: ${response.usage.totalTokens} tokens, ${(performance.now() - start).toFixed(0)}ms`);
  return response;
};

const client = new Client({
  providers: {
    anthropic: new AnthropicAdapter({ apiKey: process.env["ANTHROPIC_API_KEY"] ?? "" }),
  },
  middleware: [logging],
});
```

## Provider-Specific Features

### Anthropic extended thinking

```typescript
const result = await generate({
  model: "claude-opus-4-6",
  prompt: "Solve this step by step: what is 127 * 843?",
  providerOptions: {
    anthropic: {
      thinking: { type: "enabled", budget_tokens: 10000 },
      betaHeaders: ["interleaved-thinking-2025-05-14"],
    },
  },
});

console.log(result.reasoning); // The model's thinking process
console.log(result.text);      // The final answer
```

### Anthropic prompt caching

Automatic `cache_control` injection is enabled by default. The adapter marks breakpoints on the system prompt, tool definitions, and conversation prefix. Disable it with:

```typescript
providerOptions: {
  anthropic: { autoCache: false },
},
```

### OpenAI reasoning effort

```typescript
const result = await generate({
  model: "gpt-5.2",
  prompt: "Explain quantum entanglement.",
  reasoningEffort: "high",
  provider: "openai",
});

console.log(result.usage.reasoningTokens);
```

## Model Catalog

```typescript
import { getModelInfo, listModels, getLatestModel } from "unified-llm";

const claude = getModelInfo("claude-opus-4-6");
// { id: "claude-opus-4-6", provider: "anthropic", supportsTools: true, ... }

const anthropicModels = listModels("anthropic");
// [claude-opus-4-6, claude-sonnet-4-5]

const best = getLatestModel("openai");
// { id: "gpt-5.2", ... }
```

## Error Handling

All errors extend `SDKError` with a `retryable` flag. The `generate()` function retries automatically (default: 2 retries with exponential backoff).

```typescript
import { generate, RateLimitError, AuthenticationError, NotFoundError } from "unified-llm";

try {
  await generate({ model: "claude-opus-4-6", prompt: "Hello" });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error("Bad API key");
  } else if (error instanceof RateLimitError) {
    console.error(`Rate limited, retry after ${error.retryAfter}s`);
  } else if (error instanceof NotFoundError) {
    console.error("Model not found");
  }
}
```

## Architecture

```
Layer 4: High-Level API       generate(), stream(), generateObject(), streamObject()
Layer 3: Core Client          Client, provider routing, middleware
Layer 2: Utilities            HTTP, SSE, retry, stream accumulator, JSON
Layer 1: Types                Interfaces, discriminated unions, error hierarchy
```

## Testing

```bash
bun test
```
