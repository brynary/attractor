import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import { createOpenAIProfile } from "../../src/profiles/openai-profile.js";
import { SessionState, DEFAULT_SESSION_CONFIG } from "../../src/types/index.js";

describe("createOpenAIProfile", () => {
  const profile = createOpenAIProfile("o3");

  test("has correct id and model", () => {
    expect(profile.id).toBe("openai");
    expect(profile.model).toBe("o3");
  });

  test("registers expected tool names", () => {
    const names = profile.toolRegistry.names();
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("apply_patch");
    expect(names).toContain("shell");
    expect(names).toContain("grep");
    expect(names).toContain("glob");
  });

  test("does not have edit_file registered", () => {
    expect(profile.toolRegistry.get("edit_file")).toBeUndefined();
  });

  test("has apply_patch registered", () => {
    expect(profile.toolRegistry.get("apply_patch")).toBeDefined();
  });

  test("system prompt includes coding agent identity", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "");
    expect(prompt).toContain("coding agent");
  });

  test("system prompt includes environment context", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "");
    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("Working directory: /test");
  });

  test("tools() returns definitions matching registry", () => {
    const defs = profile.tools();
    expect(defs.length).toBe(6);
    const names = defs.map((d) => d.name);
    expect(names).toContain("apply_patch");
    expect(names).not.toContain("edit_file");
  });

  test("providerOptions returns null", () => {
    expect(profile.providerOptions()).toBeNull();
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
    const profileWithSubagents = createOpenAIProfile("o3", {
      sessionFactory: factory,
    });
    const names = profileWithSubagents.toolRegistry.names();
    expect(names).toContain("spawn_agent");
    expect(names).toContain("send_input");
    expect(names).toContain("wait");
    expect(names).toContain("close_agent");
    expect(profileWithSubagents.tools().length).toBe(10);
  });

  test("shell tool uses 10s default timeout", async () => {
    const env = new StubExecutionEnvironment({
      commandResults: new Map([
        [
          "test-cmd",
          {
            stdout: "",
            stderr: "",
            exitCode: 0,
            timedOut: true,
            durationMs: 10_000,
          },
        ],
      ]),
    });
    const shellTool = profile.toolRegistry.get("shell");
    expect(shellTool).toBeDefined();
    const result = await shellTool!.executor({ command: "test-cmd" }, env);
    expect(result).toContain("timed out after 10000ms");
  });

  test("supports overriding base prompt for strict provider alignment", () => {
    const custom = createOpenAIProfile("o3", { basePrompt: "CUSTOM_OPENAI_PROMPT" });
    const env = new StubExecutionEnvironment();
    const prompt = custom.buildSystemPrompt(env, "");
    expect(prompt).toContain("CUSTOM_OPENAI_PROMPT");
  });
});
