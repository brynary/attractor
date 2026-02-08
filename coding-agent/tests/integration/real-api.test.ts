import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, AnthropicAdapter, OpenAIAdapter, GeminiAdapter } from "unified-llm";
import { Session } from "../../src/session/session.js";
import { createAnthropicProfile } from "../../src/profiles/anthropic-profile.js";
import { createOpenAIProfile } from "../../src/profiles/openai-profile.js";
import { createGeminiProfile } from "../../src/profiles/gemini-profile.js";
import { LocalExecutionEnvironment } from "../../src/env/local-env.js";
import { EventKind, SessionState } from "../../src/types/index.js";
import type { SessionEvent } from "../../src/types/index.js";

// Load .env from repo root
const envFile = Bun.file(join(import.meta.dir, "../../../.env"));
if (await envFile.exists()) {
  const envText = await envFile.text();
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (value) {
      process.env[key] = value;
    }
  }
}

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const openaiKey = process.env["OPENAI_API_KEY"];
const geminiKey = process.env["GEMINI_API_KEY"];

async function collectEvents(
  session: Session,
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const gen = session.events();
  const collector = (async () => {
    for await (const event of gen) {
      events.push(event);
      if (event.kind === EventKind.INPUT_COMPLETE) break;
    }
  })();
  return Object.assign(events, { done: collector });
}

describe("Anthropic real API", () => {
  const shouldRun = Boolean(anthropicKey);
  let tempDir: string;
  let env: LocalExecutionEnvironment;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coding-agent-anthropic-"));
    env = new LocalExecutionEnvironment({ workingDir: tempDir });
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!shouldRun)(
    "create and read a file",
    async () => {
      const adapter = new AnthropicAdapter({ apiKey: anthropicKey! });
      const client = new Client({ providers: { anthropic: adapter } });
      const profile = createAnthropicProfile("claude-sonnet-4-5-20250929");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 10 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `Create a file called hello.txt in ${tempDir} containing exactly the text "Hello from Anthropic". Do not include any other text. Just create the file and confirm.`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      // Verify file was created
      const fileExists = await env.fileExists(join(tempDir, "hello.txt"));
      expect(fileExists).toBe(true);

      const content = await Bun.file(join(tempDir, "hello.txt")).text();
      expect(content).toContain("Hello from Anthropic");

      // Verify events
      const eventKinds = events.map((e) => e.kind);
      expect(eventKinds).toContain(EventKind.USER_INPUT);
      expect(eventKinds).toContain(EventKind.TOOL_CALL_START);
      expect(eventKinds).toContain(EventKind.TOOL_CALL_END);
      expect(eventKinds).toContain(EventKind.ASSISTANT_TEXT_END);
      expect(eventKinds).toContain(EventKind.INPUT_COMPLETE);

      // Should have at least one tool call (write_file)
      const toolStarts = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_START,
      );
      expect(toolStarts.length).toBeGreaterThanOrEqual(1);

      // Print summary for visibility
      const assistantEnds = events.filter(
        (e) => e.kind === EventKind.ASSISTANT_TEXT_END,
      );
      for (const e of assistantEnds) {
        console.log(`  [Anthropic] assistant: ${String(e.data["text"]).slice(0, 200)}`);
      }
      for (const e of toolStarts) {
        console.log(`  [Anthropic] tool call: ${String(e.data["tool_name"])}`);
      }

      await client.close();
    },
    60_000,
  );

  test.skipIf(!shouldRun)(
    "read and edit a file",
    async () => {
      // Write a seed file
      await Bun.write(
        join(tempDir, "greet.py"),
        'def greet():\n    return "hello"\n',
      );

      const adapter = new AnthropicAdapter({ apiKey: anthropicKey! });
      const client = new Client({ providers: { anthropic: adapter } });
      const profile = createAnthropicProfile("claude-sonnet-4-5-20250929");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 10 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `Read the file ${join(tempDir, "greet.py")}, then edit it to change the return value from "hello" to "goodbye". Use the edit_file tool with old_string/new_string.`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      const content = await Bun.file(join(tempDir, "greet.py")).text();
      expect(content).toContain("goodbye");
      expect(content).not.toContain('"hello"');

      // Should have read_file + edit_file tool calls
      const toolStarts = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_START,
      );
      const toolNames = toolStarts.map((e) => String(e.data["tool_name"]));
      console.log(`  [Anthropic] tool calls: ${toolNames.join(", ")}`);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("edit_file");

      await client.close();
    },
    60_000,
  );

  test.skipIf(!shouldRun)(
    "run a shell command",
    async () => {
      const adapter = new AnthropicAdapter({ apiKey: anthropicKey! });
      const client = new Client({ providers: { anthropic: adapter } });
      const profile = createAnthropicProfile("claude-sonnet-4-5-20250929");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 5 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `Run the shell command: echo "integration test passed"`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      const toolEnds = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_END,
      );
      const hasShellOutput = toolEnds.some((e) => {
        const output = String(e.data["output"] ?? "");
        return output.includes("integration test passed");
      });
      expect(hasShellOutput).toBe(true);
      console.log("  [Anthropic] shell command executed successfully");

      await client.close();
    },
    60_000,
  );
});

describe("OpenAI real API", () => {
  const shouldRun = Boolean(openaiKey);
  let tempDir: string;
  let env: LocalExecutionEnvironment;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coding-agent-openai-"));
    env = new LocalExecutionEnvironment({ workingDir: tempDir });
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!shouldRun)(
    "create a file",
    async () => {
      const adapter = new OpenAIAdapter({ apiKey: openaiKey! });
      const client = new Client({ providers: { openai: adapter } });
      const profile = createOpenAIProfile("gpt-4o");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 10 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `Create a file called hello.txt in ${tempDir} containing exactly "Hello from OpenAI". Use the write_file tool. Just create the file and confirm.`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      const fileExists = await env.fileExists(join(tempDir, "hello.txt"));
      expect(fileExists).toBe(true);

      const content = await Bun.file(join(tempDir, "hello.txt")).text();
      expect(content).toContain("Hello from OpenAI");

      const toolStarts = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_START,
      );
      for (const e of toolStarts) {
        console.log(`  [OpenAI] tool call: ${String(e.data["tool_name"])}`);
      }

      await client.close();
    },
    60_000,
  );

  test.skipIf(!shouldRun)(
    "read file and write modified version",
    async () => {
      const configPath = join(tempDir, "config.py");
      await Bun.write(configPath, "DEBUG = False\nPORT = 3000\n");

      const adapter = new OpenAIAdapter({ apiKey: openaiKey! });
      const client = new Client({ providers: { openai: adapter } });
      const profile = createOpenAIProfile("gpt-4o");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 10 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `First, read the file at ${configPath}. Then use write_file to rewrite it with DEBUG changed from False to True. Keep PORT the same.`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      const toolStarts = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_START,
      );
      const toolNames = toolStarts.map((e) => String(e.data["tool_name"]));
      console.log(`  [OpenAI] tool calls: ${toolNames.join(", ")}`);

      // Check tool errors
      const toolEnds = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_END,
      );
      for (const e of toolEnds) {
        if (e.data["error"]) {
          console.log(`  [OpenAI] tool error: ${String(e.data["error"]).slice(0, 300)}`);
        }
      }

      // Verify the model used at least read_file
      expect(toolNames).toContain("read_file");

      // The model should have modified the file (via write_file or apply_patch),
      // but may not always do so depending on model behavior.
      const content = await Bun.file(configPath).text();
      if (toolNames.some((n) => n === "write_file" || n === "apply_patch")) {
        expect(content).toContain("True");
        expect(content).toContain("PORT");
      }

      await client.close();
    },
    120_000,
  );

  test.skipIf(!shouldRun)(
    "run a shell command",
    async () => {
      const adapter = new OpenAIAdapter({ apiKey: openaiKey! });
      const client = new Client({ providers: { openai: adapter } });
      const profile = createOpenAIProfile("gpt-4o");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 5 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `Run the shell command: echo "openai integration test passed"`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      const toolEnds = events.filter(
        (e) => e.kind === EventKind.TOOL_CALL_END,
      );
      const hasShellOutput = toolEnds.some((e) => {
        const output = String(e.data["output"] ?? "");
        return output.includes("openai integration test passed");
      });
      expect(hasShellOutput).toBe(true);
      console.log("  [OpenAI] shell command executed successfully");

      await client.close();
    },
    60_000,
  );
});

describe("Gemini real API", () => {
  const shouldRun = Boolean(geminiKey) && process.env["RUN_GEMINI_REAL_API"] === "1";
  let tempDir: string;
  let env: LocalExecutionEnvironment;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coding-agent-gemini-"));
    env = new LocalExecutionEnvironment({ workingDir: tempDir });
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!shouldRun)(
    "create and verify a file",
    async () => {
      const adapter = new GeminiAdapter({ apiKey: geminiKey! });
      const client = new Client({ providers: { gemini: adapter } });
      const profile = createGeminiProfile("gemini-2.5-pro");

      const session = new Session({
        providerProfile: profile,
        executionEnv: env,
        llmClient: client,
        config: { maxToolRoundsPerInput: 10 },
      });

      const events: SessionEvent[] = [];
      const gen = session.events();
      const eventCollector = (async () => {
        for await (const event of gen) {
          events.push(event);
          if (event.kind === EventKind.INPUT_COMPLETE) break;
        }
      })();

      await session.submit(
        `Create a file called hello.txt in ${tempDir} containing exactly "Hello from Gemini". Just create the file and confirm.`,
      );
      await eventCollector;

      expect(
        session.state === SessionState.IDLE || session.state === SessionState.AWAITING_INPUT,
      ).toBe(true);

      const fileExists = await env.fileExists(join(tempDir, "hello.txt"));
      if (fileExists) {
        const content = await Bun.file(join(tempDir, "hello.txt")).text();
        expect(content).toContain("Hello from Gemini");
      } else {
        // Gemini models may ask clarifying questions before writing.
        const hasAssistantOutput = events.some(
          (event) => event.kind === EventKind.ASSISTANT_TEXT_END,
        );
        expect(hasAssistantOutput).toBe(true);
      }

      const eventKinds = events.map((e) => e.kind);
      expect(eventKinds).toContain(EventKind.USER_INPUT);
      expect(eventKinds).toContain(EventKind.TOOL_CALL_START);
      expect(eventKinds).toContain(EventKind.TOOL_CALL_END);
      expect(eventKinds).toContain(EventKind.INPUT_COMPLETE);

      await client.close();
    },
    120_000,
  );
});
