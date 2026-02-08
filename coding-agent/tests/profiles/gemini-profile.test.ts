import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import { createGeminiProfile } from "../../src/profiles/gemini-profile.js";

describe("createGeminiProfile", () => {
  const profile = createGeminiProfile("gemini-2.5-pro");

  test("has correct id and model", () => {
    expect(profile.id).toBe("gemini");
    expect(profile.model).toBe("gemini-2.5-pro");
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

  test("system prompt includes GEMINI.md reference", () => {
    const env = new StubExecutionEnvironment();
    const prompt = profile.buildSystemPrompt(env, "");
    expect(prompt).toContain("GEMINI.md");
  });

  test("tools() returns definitions matching registry", () => {
    const defs = profile.tools();
    expect(defs.length).toBe(6);
    const names = defs.map((d) => d.name);
    expect(names).toContain("read_file");
    expect(names).toContain("edit_file");
  });

  test("providerOptions returns null", () => {
    expect(profile.providerOptions()).toBeNull();
  });

  test("has correct capability flags", () => {
    expect(profile.supportsReasoning).toBe(false);
    expect(profile.supportsStreaming).toBe(true);
    expect(profile.supportsParallelToolCalls).toBe(true);
    expect(profile.contextWindowSize).toBe(1_000_000);
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

  test("registers subagent tools when sessionFactory provided", () => {
    const factory = async () => ({
      id: "agent-1",
      status: "running" as const,
      submit: async () => {},
      waitForCompletion: async () => ({ output: "", success: true, turnsUsed: 0 }),
      close: async () => {},
    });
    const profileWithSubagents = createGeminiProfile("gemini-2.5-pro", {
      sessionFactory: factory,
    });
    const names = profileWithSubagents.toolRegistry.names();
    expect(names).toContain("spawn_agent");
    expect(names).toContain("send_input");
    expect(names).toContain("wait");
    expect(names).toContain("close_agent");
    expect(profileWithSubagents.tools().length).toBe(10);
  });
});
