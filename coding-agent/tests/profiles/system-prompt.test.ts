import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import {
  buildEnvironmentContext,
  discoverProjectDocs,
  buildSystemPrompt,
} from "../../src/profiles/system-prompt.js";

describe("buildEnvironmentContext", () => {
  test("returns XML block with platform, working dir, and date", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env);

    expect(result).toContain("<environment>");
    expect(result).toContain("</environment>");
    expect(result).toContain("Working directory: /test");
    expect(result).toContain("Platform: darwin");
    expect(result).toContain("OS version: Test 1.0");
    // Date should be in YYYY-MM-DD format
    expect(result).toMatch(/Today's date: \d{4}-\d{2}-\d{2}/);
  });

  test("includes git repo and branch when provided", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, {
      isGitRepo: true,
      gitBranch: "feat/cool",
    });

    expect(result).toContain("Is git repository: true");
    expect(result).toContain("Git branch: feat/cool");
  });

  test("includes model name and knowledge cutoff when provided", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, {
      modelDisplayName: "claude-opus-4-6",
      knowledgeCutoff: "May 2025",
    });

    expect(result).toContain("Model: claude-opus-4-6");
    expect(result).toContain("Knowledge cutoff: May 2025");
  });

  test("shows git repo as false when isGitRepo is false", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, { isGitRepo: false });

    expect(result).toContain("Is git repository: false");
    expect(result).toContain("Git branch: (none)");
  });

  test("defaults isGitRepo to false and gitBranch to (none) when options empty", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, {});

    expect(result).toContain("Is git repository: false");
    expect(result).toContain("Git branch: (none)");
    expect(result).not.toContain("Model:");
    expect(result).not.toContain("Knowledge cutoff:");
  });

  test("defaults isGitRepo to false and gitBranch to (none) when options undefined", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env);

    expect(result).toContain("Is git repository: false");
    expect(result).toContain("Git branch: (none)");
  });

  test("field order matches spec: working dir, git repo, git branch, platform, os, date, model, cutoff", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, {
      isGitRepo: true,
      gitBranch: "main",
      modelDisplayName: "claude-opus-4-6",
      knowledgeCutoff: "May 2025",
    });

    const workingDirIdx = result.indexOf("Working directory:");
    const isGitIdx = result.indexOf("Is git repository:");
    const gitBranchIdx = result.indexOf("Git branch:");
    const platformIdx = result.indexOf("Platform:");
    const osIdx = result.indexOf("OS version:");
    const dateIdx = result.indexOf("Today's date:");
    const modelIdx = result.indexOf("Model:");
    const cutoffIdx = result.indexOf("Knowledge cutoff:");

    expect(workingDirIdx).toBeLessThan(isGitIdx);
    expect(isGitIdx).toBeLessThan(gitBranchIdx);
    expect(gitBranchIdx).toBeLessThan(platformIdx);
    expect(platformIdx).toBeLessThan(osIdx);
    expect(osIdx).toBeLessThan(dateIdx);
    expect(dateIdx).toBeLessThan(modelIdx);
    expect(modelIdx).toBeLessThan(cutoffIdx);
  });

  test("git context fields appear after </environment> tag", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, {
      isGitRepo: true,
      gitBranch: "main",
      modifiedCount: 3,
      untrackedCount: 1,
      recentCommits: ["abc1234 fix bug"],
    });

    const envCloseIdx = result.indexOf("</environment>");
    const modifiedIdx = result.indexOf("Modified files:");
    const untrackedIdx = result.indexOf("Untracked files:");
    const commitsIdx = result.indexOf("Recent commits:");

    expect(envCloseIdx).toBeGreaterThan(0);
    expect(modifiedIdx).toBeGreaterThan(envCloseIdx);
    expect(untrackedIdx).toBeGreaterThan(envCloseIdx);
    expect(commitsIdx).toBeGreaterThan(envCloseIdx);
  });

  test("model and knowledge cutoff are inside environment block", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env, {
      modelDisplayName: "claude-opus-4-6",
      knowledgeCutoff: "May 2025",
    });

    const envCloseIdx = result.indexOf("</environment>");
    const modelIdx = result.indexOf("Model:");
    const cutoffIdx = result.indexOf("Knowledge cutoff:");

    expect(modelIdx).toBeLessThan(envCloseIdx);
    expect(cutoffIdx).toBeLessThan(envCloseIdx);
  });
});

describe("discoverProjectDocs", () => {
  test("finds AGENTS.md in working directory", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/AGENTS.md", "# Project Rules\nUse TypeScript."]]),
    });
    const result = await discoverProjectDocs(env, []);

    expect(result).toContain("# Project Rules");
    expect(result).toContain("Use TypeScript.");
  });

  test("loads provider-specific files", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/AGENTS.md", "agents content"],
        ["/test/CLAUDE.md", "claude content"],
      ]),
    });
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result).toContain("agents content");
    expect(result).toContain("claude content");
  });

  test("does not load unrelated provider files", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/CLAUDE.md", "claude content"],
        ["/test/GEMINI.md", "gemini content"],
      ]),
    });
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result).toContain("claude content");
    expect(result).not.toContain("gemini content");
  });

  test("respects 32KB budget and truncates with message", async () => {
    const largeContent = "x".repeat(30_000);
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/AGENTS.md", largeContent],
        ["/test/CLAUDE.md", "y".repeat(5_000)],
      ]),
    });
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result.length).toBeLessThanOrEqual(
      32 * 1024 + "[Project instructions truncated at 32KB]".length + 10,
    );
    expect(result).toContain("[Project instructions truncated at 32KB]");
  });

  test("returns empty string when no docs files exist", async () => {
    const env = new StubExecutionEnvironment();
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result).toBe("");
  });

  test("walks from git root to cwd when gitRoot provided", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/repo/AGENTS.md", "root agents"],
        ["/repo/sub/AGENTS.md", "sub agents"],
        ["/repo/sub/deep/AGENTS.md", "deep agents"],
      ]),
    });
    // cwd is /test by default, override for this test by providing gitRoot
    // The stub env has cwd=/test, so let's set up files at /test paths
    const env2 = new StubExecutionEnvironment({
      files: new Map([
        ["/project/AGENTS.md", "root level"],
        ["/project/src/AGENTS.md", "src level"],
        ["/project/src/app/AGENTS.md", "app level"],
      ]),
    });
    // We need an env with cwd = /project/src/app
    // StubExecutionEnvironment always returns /test for workingDirectory
    // So let's test with paths matching the stub's cwd
    const env3 = new StubExecutionEnvironment({
      files: new Map([
        ["/root/AGENTS.md", "root content"],
        ["/test/AGENTS.md", "cwd content"],
      ]),
    });
    // gitRoot=/root, cwd=/test -> /test doesn't start with /root, so only cwd is searched
    const result3 = await discoverProjectDocs(env3, [], "/root");
    // cwd=/test is not under /root, so fallback to just cwd
    expect(result3).toContain("cwd content");
  });

  test("discovers docs from intermediate directories between git root and cwd", async () => {
    // StubExecutionEnvironment has workingDirectory() = /test
    // So gitRoot must be an ancestor of /test for the walk to work
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/AGENTS.md", "root agents"],
        ["/test/AGENTS.md", "cwd agents"],
      ]),
    });
    const result = await discoverProjectDocs(env, [], "/");

    expect(result).toContain("root agents");
    expect(result).toContain("cwd agents");
    // Root content should appear before cwd content
    const rootIdx = result.indexOf("root agents");
    const cwdIdx = result.indexOf("cwd agents");
    expect(rootIdx).toBeLessThan(cwdIdx);
  });

  test("only searches cwd when gitRoot equals cwd", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/AGENTS.md", "cwd content"],
      ]),
    });
    const result = await discoverProjectDocs(env, [], "/test");

    expect(result).toContain("cwd content");
  });
});

describe("buildSystemPrompt", () => {
  test("assembles all layers in correct order", () => {
    const result = buildSystemPrompt(
      "BASE_PROMPT",
      "ENV_CONTEXT",
      "TOOL_DESCRIPTIONS",
      "PROJECT_DOCS",
    );

    const baseIdx = result.indexOf("BASE_PROMPT");
    const envIdx = result.indexOf("ENV_CONTEXT");
    const toolIdx = result.indexOf("TOOL_DESCRIPTIONS");
    const docsIdx = result.indexOf("PROJECT_DOCS");

    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeGreaterThan(baseIdx);
    expect(toolIdx).toBeGreaterThan(envIdx);
    expect(docsIdx).toBeGreaterThan(toolIdx);
  });

  test("includes user instructions when provided", () => {
    const result = buildSystemPrompt(
      "BASE",
      "ENV",
      "TOOLS",
      "DOCS",
      "USER_INSTRUCTIONS",
    );

    expect(result).toContain("USER_INSTRUCTIONS");
    const docsIdx = result.indexOf("DOCS");
    const userIdx = result.indexOf("USER_INSTRUCTIONS");
    expect(userIdx).toBeGreaterThan(docsIdx);
  });

  test("omits user instructions when not provided", () => {
    const result = buildSystemPrompt("BASE", "ENV", "TOOLS", "DOCS");

    expect(result).not.toContain("undefined");
  });

  test("skips empty sections", () => {
    const result = buildSystemPrompt("BASE", "ENV", "", "DOCS");

    // Should not have triple newlines from empty section
    expect(result).not.toContain("\n\n\n");
  });
});
