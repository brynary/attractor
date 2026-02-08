import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import { createGeminiProfile } from "../../src/profiles/gemini-profile.js";
import { SessionState, DEFAULT_SESSION_CONFIG } from "../../src/types/index.js";

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
    expect(names).toContain("list_dir");
    expect(names).toContain("read_many_files");
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
    expect(defs.length).toBe(10);
    const names = defs.map((d) => d.name);
    expect(names).toContain("read_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("read_many_files");
  });

  test("providerOptions returns gemini safety settings and grounding", () => {
    const opts = profile.providerOptions();
    expect(opts).not.toBeNull();
    const gemini = opts?.gemini;
    expect(gemini).toBeDefined();
    const settings = gemini?.safety_settings as Array<Record<string, string>>;
    expect(settings).toHaveLength(1);
    expect(settings[0]?.category).toBe("HARM_CATEGORY_DANGEROUS_CONTENT");
    expect(settings[0]?.threshold).toBe("BLOCK_NONE");
    const grounding = gemini?.grounding as Record<string, unknown>;
    expect(grounding).toBeDefined();
    expect(grounding.google_search).toBe(true);
  });

  test("has correct capability flags", () => {
    expect(profile.supportsReasoning).toBe(true);
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
      session: { id: "s-1", state: SessionState.IDLE, history: [] as const, config: DEFAULT_SESSION_CONFIG },
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
    expect(profileWithSubagents.tools().length).toBe(14);
  });

  test("list_dir returns formatted directory listing", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/project/src/index.ts", "export {}"],
        ["/project/src/utils/helper.ts", "export function help() {}"],
        ["/project/README.md", "# Project"],
      ]),
    });
    const tool = profile.toolRegistry.get("list_dir");
    expect(tool).toBeDefined();
    const result = await tool!.executor({ path: "/project" }, env);
    expect(result).toContain("/project/");
    expect(result).toContain("src/");
    expect(result).toContain("README.md");
  });

  test("list_dir shows empty directory", async () => {
    const env = new StubExecutionEnvironment();
    const tool = profile.toolRegistry.get("list_dir");
    expect(tool).toBeDefined();
    const result = await tool!.executor({ path: "/empty" }, env);
    expect(result).toContain("(empty)");
  });

  test("read_many_files returns concatenated content", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/a.ts", "const a = 1;"],
        ["/b.ts", "const b = 2;"],
      ]),
    });
    const tool = profile.toolRegistry.get("read_many_files");
    expect(tool).toBeDefined();
    const result = await tool!.executor({ paths: ["/a.ts", "/b.ts"] }, env);
    expect(result).toContain("=== /a.ts ===");
    expect(result).toContain("=== /b.ts ===");
    expect(result).toContain("const a = 1;");
    expect(result).toContain("const b = 2;");
  });

  test("read_many_files includes error for missing files", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/exists.ts", "hello"],
      ]),
    });
    const tool = profile.toolRegistry.get("read_many_files");
    expect(tool).toBeDefined();
    const result = await tool!.executor(
      { paths: ["/exists.ts", "/missing.ts"] },
      env,
    );
    expect(result).toContain("=== /exists.ts ===");
    expect(result).toContain("=== /missing.ts ===");
    expect(result).toContain("[ERROR:");
  });

  test("supports overriding base prompt for strict provider alignment", () => {
    const custom = createGeminiProfile("gemini-2.5-pro", {
      basePrompt: "CUSTOM_GEMINI_PROMPT",
    });
    const env = new StubExecutionEnvironment();
    const prompt = custom.buildSystemPrompt(env, "");
    expect(prompt).toContain("CUSTOM_GEMINI_PROMPT");
  });
});
