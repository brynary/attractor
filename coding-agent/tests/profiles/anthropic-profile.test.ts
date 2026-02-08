import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import { createAnthropicProfile } from "../../src/profiles/anthropic-profile.js";
import { SessionState, DEFAULT_SESSION_CONFIG } from "../../src/types/index.js";

describe("createAnthropicProfile", () => {
  const profile = createAnthropicProfile("claude-opus-4-6");

  test("has correct id and model", () => {
    expect(profile.id).toBe("anthropic");
    expect(profile.model).toBe("claude-opus-4-6");
  });

  test("registers expected tool names", () => {
    const names = profile.toolRegistry.names();
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("shell");
    expect(names).toContain("grep");
    expect(names).toContain("glob");
  });

  test("does not have apply_patch registered", () => {
    expect(profile.toolRegistry.get("apply_patch")).toBeUndefined();
  });

  test("system prompt includes Claude identity reference", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "");
    expect(prompt).toContain("Claude");
  });

  test("system prompt mentions CLAUDE.md project instructions", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "");
    expect(prompt).toContain("CLAUDE.md");
  });

  test("system prompt includes environment context", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "");
    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("Working directory: /test");
    expect(prompt).toContain("Platform: darwin");
  });

  test("system prompt includes project docs when provided", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "Custom project rules");
    expect(prompt).toContain("Custom project rules");
  });

  test("system prompt includes user instructions as layer 5", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "", undefined, "Always use semicolons");
    expect(prompt).toContain("Always use semicolons");
  });

  test("tools() returns definitions matching registry", () => {
    const defs = profile.tools();
    expect(defs.length).toBe(6);
    const names = defs.map((d) => d.name);
    expect(names).toContain("read_file");
    expect(names).toContain("edit_file");
  });

  test("providerOptions returns anthropic beta headers", () => {
    const options = profile.providerOptions();
    expect(options).not.toBeNull();
    const headers = options?.anthropic?.betaHeaders;
    expect(Array.isArray(headers)).toBe(true);
    expect(headers).toContain("interleaved-thinking-2025-05-14");
    expect(headers).toContain("output-128k-2025-02-19");
  });

  test("has correct capability flags", () => {
    expect(profile.supportsReasoning).toBe(true);
    expect(profile.supportsStreaming).toBe(true);
    expect(profile.supportsParallelToolCalls).toBe(true);
    expect(profile.contextWindowSize).toBe(200_000);
  });

  test("registers subagent tools when sessionFactory provided", () => {
    const factory = async () => ({
      id: "agent-1",
      status: "running" as const,
      session: { id: "s-1", state: SessionState.IDLE, history: [] as const, config: DEFAULT_SESSION_CONFIG },
      submit: async () => {},
      waitForCompletion: async () => ({ output: "", success: true, turnsUsed: 0 }),
      close: async () => {},
    });
    const profileWithSubagents = createAnthropicProfile("claude-opus-4-6", {
      sessionFactory: factory,
    });
    const names = profileWithSubagents.toolRegistry.names();
    expect(names).toContain("spawn_agent");
    expect(names).toContain("send_input");
    expect(names).toContain("wait");
    expect(names).toContain("close_agent");
    expect(profileWithSubagents.tools().length).toBe(10);
  });

  test("shell tool uses 120s default timeout per Claude Code convention", async () => {
    const env = new StubExecutionEnvironment({
      commandResults: new Map([
        [
          "test-cmd",
          {
            stdout: "",
            stderr: "",
            exitCode: 0,
            timedOut: true,
            durationMs: 120_000,
          },
        ],
      ]),
    });
    const shellTool = profile.toolRegistry.get("shell");
    expect(shellTool).toBeDefined();
    const result = await shellTool!.executor({ command: "test-cmd" }, env);
    expect(result).toContain("timed out after 120000ms");
  });

  test("supports overriding base prompt for strict provider alignment", () => {
    const custom = createAnthropicProfile("claude-opus-4-6", {
      basePrompt: "CUSTOM_ANTHROPIC_PROMPT",
    });
    const env = new StubExecutionEnvironment();
    const prompt = custom.buildSystemPrompt(env, "");
    expect(prompt).toContain("CUSTOM_ANTHROPIC_PROMPT");
  });
});
