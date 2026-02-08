import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import {
  parsePatch,
  applyPatch,
  applyHunks,
  normalizeForFuzzyMatch,
  createApplyPatchTool,
} from "../../src/tools/apply-patch.js";
import type { ExecutionEnvironment } from "../../src/types/execution-env.js";

describe("parsePatch", () => {
  test("throws on missing Begin Patch", () => {
    expect(() => parsePatch("some random text")).toThrow(
      "missing '*** Begin Patch'",
    );
  });

  test("throws on missing End Patch", () => {
    const patch = `*** Begin Patch
*** Add File: src/hello.ts
+export const hello = "world";`;
    expect(() => parsePatch(patch)).toThrow("missing '*** End Patch'");
  });

  test("parses add file operation", () => {
    const patch = `*** Begin Patch
*** Add File: src/hello.ts
+export const hello = "world";
*** End Patch`;
    const ops = parsePatch(patch);
    expect(ops.length).toBe(1);
    expect(ops[0]?.kind).toBe("add");
    expect(ops[0]?.path).toBe("src/hello.ts");
    expect(ops[0]?.content).toBe('export const hello = "world";');
  });

  test("parses delete file operation", () => {
    const patch = `*** Begin Patch
*** Delete File: old/file.ts
*** End Patch`;
    const ops = parsePatch(patch);
    expect(ops.length).toBe(1);
    expect(ops[0]?.kind).toBe("delete");
    expect(ops[0]?.path).toBe("old/file.ts");
  });

  test("parses update file operation with hunks", () => {
    const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ export function main
 export function main() {
-  console.log("old");
+  console.log("new");
 }
*** End Patch`;
    const ops = parsePatch(patch);
    expect(ops.length).toBe(1);
    expect(ops[0]?.kind).toBe("update");
    expect(ops[0]?.hunks?.length).toBe(1);
    expect(ops[0]?.hunks?.[0]?.contextHint).toBe("export function main");
    expect(ops[0]?.hunks?.[0]?.lines.length).toBe(4);
  });
});

describe("applyPatch", () => {
  test("adds a new file", async () => {
    const env = new StubExecutionEnvironment();
    const patch = `*** Begin Patch
*** Add File: /test/new.ts
+const x = 1;
+const y = 2;
*** End Patch`;
    const result = await applyPatch(patch, env);
    expect(result).toContain("Added /test/new.ts");
    expect(await env.fileExists("/test/new.ts")).toBe(true);
  });

  test("deletes a file", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/old.ts", "content"]]),
    });
    const patch = `*** Begin Patch
*** Delete File: /test/old.ts
*** End Patch`;
    const result = await applyPatch(patch, env);
    expect(result).toContain("Deleted /test/old.ts");
  });

  test("updates a file with a single hunk", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/main.ts", 'function greet() {\n  console.log("hello");\n}'],
      ]),
    });
    const patch = `*** Begin Patch
*** Update File: /test/main.ts
@@ function greet
 function greet() {
-  console.log("hello");
+  console.log("goodbye");
 }
*** End Patch`;
    const result = await applyPatch(patch, env);
    expect(result).toContain("Updated /test/main.ts");

    const content = await env.readFile("/test/main.ts");
    expect(content).toContain("goodbye");
    expect(content).not.toContain("hello");
  });

  test("updates a file with multiple hunks", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        [
          "/test/multi.ts",
          "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;",
        ],
      ]),
    });
    const patch = `*** Begin Patch
*** Update File: /test/multi.ts
@@ const a
-const a = 1;
+const a = 10;
 const b = 2;
@@ const d
 const d = 4;
-const e = 5;
+const e = 50;
*** End Patch`;
    const result = await applyPatch(patch, env);
    expect(result).toContain("Updated /test/multi.ts");

    const content = await env.readFile("/test/multi.ts");
    expect(content).toContain("a = 10");
    expect(content).toContain("e = 50");
    expect(content).toContain("b = 2");
  });

  test("updates and moves (renames) a file", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/old-name.ts", "const x = 1;\nconst y = 2;"],
      ]),
    });
    const patch = `*** Begin Patch
*** Update File: /test/old-name.ts
*** Move to: /test/new-name.ts
@@ const x
-const x = 1;
+const x = 100;
 const y = 2;
*** End Patch`;
    const result = await applyPatch(patch, env);
    expect(result).toContain("Updated and moved /test/old-name.ts -> /test/new-name.ts");
    expect(await env.fileExists("/test/new-name.ts")).toBe(true);
  });

  test("applies full patch with add, update, and delete", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/existing.ts", "const old = true;"],
        ["/test/remove-me.ts", "gone"],
      ]),
    });
    const patch = `*** Begin Patch
*** Add File: /test/brand-new.ts
+export const fresh = true;
*** Update File: /test/existing.ts
@@ const old
-const old = true;
+const old = false;
*** Delete File: /test/remove-me.ts
*** End Patch`;
    const result = await applyPatch(patch, env);
    expect(result).toContain("Added /test/brand-new.ts");
    expect(result).toContain("Updated /test/existing.ts");
    expect(result).toContain("Deleted /test/remove-me.ts");

    expect(await env.fileExists("/test/brand-new.ts")).toBe(true);
    const content = await env.readFile("/test/existing.ts");
    expect(content).toContain("old = false");
  });
});

describe("createApplyPatchTool", () => {
  test("tool definition has correct name", () => {
    const tool = createApplyPatchTool();
    expect(tool.definition.name).toBe("apply_patch");
  });

  test("executor applies a patch", async () => {
    const env = new StubExecutionEnvironment();
    const tool = createApplyPatchTool();
    const patch = `*** Begin Patch
*** Add File: /test/via-tool.ts
+hello
*** End Patch`;
    const result = await tool.executor({ patch }, env);
    expect(result).toContain("Added /test/via-tool.ts");
  });
});

describe("normalizeForFuzzyMatch", () => {
  test("collapses multiple spaces to single space", () => {
    expect(normalizeForFuzzyMatch("foo   bar")).toBe("foo bar");
  });

  test("collapses tabs to single space", () => {
    expect(normalizeForFuzzyMatch("foo\t\tbar")).toBe("foo bar");
  });

  test("trims trailing whitespace", () => {
    expect(normalizeForFuzzyMatch("foo bar   ")).toBe("foo bar");
  });

  test("preserves leading whitespace but normalizes it", () => {
    expect(normalizeForFuzzyMatch("  foo  bar")).toBe(" foo bar");
  });

  test("normalizes curly double quotes to straight double quotes", () => {
    expect(normalizeForFuzzyMatch("say \u201Chello\u201D")).toBe('say "hello"');
  });

  test("normalizes curly single quotes to straight single quotes", () => {
    expect(normalizeForFuzzyMatch("it\u2019s \u2018fine\u2019")).toBe("it's 'fine'");
  });

  test("normalizes em-dash and en-dash to hyphen", () => {
    expect(normalizeForFuzzyMatch("a\u2014b\u2013c")).toBe("a-b-c");
  });

  test("normalizes non-breaking space to regular space", () => {
    expect(normalizeForFuzzyMatch("foo\u00A0bar")).toBe("foo bar");
  });

  test("normalizes ellipsis to three dots", () => {
    expect(normalizeForFuzzyMatch("wait\u2026")).toBe("wait...");
  });

  test("combines whitespace and Unicode normalization", () => {
    expect(normalizeForFuzzyMatch("  \u201Chello\u201D\t\t world\u2026  ")).toBe(' "hello" world...');
  });
});

describe("applyHunks fuzzy matching", () => {
  test("matches when file has extra whitespace compared to hunk", () => {
    // File has tabs, hunk has spaces -- fuzzy matching should handle it
    const content = "function greet() {\n\t\tconsole.log(\"hello\");\n}";
    const result = applyHunks(content, [
      {
        contextHint: "function greet",
        lines: [
          { kind: "context", content: "function greet() {" },
          { kind: "delete", content: "  console.log(\"hello\");" },
          { kind: "add", content: "  console.log(\"goodbye\");" },
          { kind: "context", content: "}" },
        ],
      },
    ]);
    expect(result).toContain("goodbye");
    expect(result).not.toContain("hello");
  });

  test("matches when hunk has trailing whitespace differences", () => {
    const content = "const a = 1;   \nconst b = 2;";
    const result = applyHunks(content, [
      {
        contextHint: "const a",
        lines: [
          { kind: "delete", content: "const a = 1;" },
          { kind: "add", content: "const a = 10;" },
          { kind: "context", content: "const b = 2;" },
        ],
      },
    ]);
    expect(result).toContain("a = 10");
  });

  test("matches when file has smart quotes but hunk has straight quotes", () => {
    const content = "function greet() {\n  console.log(\u201Chello\u201D);\n}";
    const result = applyHunks(content, [
      {
        contextHint: "function greet",
        lines: [
          { kind: "context", content: "function greet() {" },
          { kind: "delete", content: '  console.log("hello");' },
          { kind: "add", content: '  console.log("goodbye");' },
          { kind: "context", content: "}" },
        ],
      },
    ]);
    expect(result).toContain("goodbye");
    expect(result).not.toContain("hello");
  });

  test("throws when even fuzzy matching fails", () => {
    const content = "completely different content";
    expect(() =>
      applyHunks(content, [
        {
          contextHint: "nonexistent",
          lines: [
            { kind: "context", content: "no such line in file" },
          ],
        },
      ]),
    ).toThrow("even after fuzzy matching");
  });
});

describe("parsePatch End of File marker", () => {
  test("skips *** End of File lines inside hunks", () => {
    const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ last line
-old last line
+new last line
*** End of File
*** End Patch`;
    const ops = parsePatch(patch);
    expect(ops.length).toBe(1);
    expect(ops[0]?.hunks?.length).toBe(1);
    // End of File should not appear as a hunk line
    const hunkLines = ops[0]?.hunks?.[0]?.lines ?? [];
    expect(hunkLines.length).toBe(2);
    expect(hunkLines[0]?.kind).toBe("delete");
    expect(hunkLines[1]?.kind).toBe("add");
  });

  test("handles End of File before next hunk", () => {
    const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ first hunk
-old first
+new first
*** End of File
@@ second hunk
-old second
+new second
*** End Patch`;
    const ops = parsePatch(patch);
    expect(ops[0]?.hunks?.length).toBe(2);
  });
});

describe("applyPatch shell escaping", () => {
  test("delete command escapes single quotes in path", async () => {
    const recordedCommands: string[] = [];
    const stub = new StubExecutionEnvironment({
      files: new Map([["/test/it's a file.ts", "content"]]),
    });
    // Wrap execCommand to capture the command string
    const origExec = stub.execCommand.bind(stub);
    stub.execCommand = async (
      command: string,
      timeoutMs: number,
      workingDir?: string,
      envVars?: Record<string, string>,
    ) => {
      recordedCommands.push(command);
      return origExec(command, timeoutMs, workingDir, envVars);
    };

    const patch = `*** Begin Patch
*** Delete File: /test/it's a file.ts
*** End Patch`;
    await applyPatch(patch, stub);
    expect(recordedCommands.length).toBe(1);
    // Should use -- to prevent path from being interpreted as flag
    expect(recordedCommands[0]).toContain("rm --");
    // Should properly escape single quote
    expect(recordedCommands[0]).toContain("'\\''");
  });

  test("update-move command escapes path in rm", async () => {
    const recordedCommands: string[] = [];
    const stub = new StubExecutionEnvironment({
      files: new Map([["/test/old file.ts", "const x = 1;"]]),
    });
    const origExec = stub.execCommand.bind(stub);
    stub.execCommand = async (
      command: string,
      timeoutMs: number,
      workingDir?: string,
      envVars?: Record<string, string>,
    ) => {
      recordedCommands.push(command);
      return origExec(command, timeoutMs, workingDir, envVars);
    };

    const patch = `*** Begin Patch
*** Update File: /test/old file.ts
*** Move to: /test/new file.ts
@@ const x
-const x = 1;
+const x = 2;
*** End Patch`;
    await applyPatch(patch, stub);
    expect(recordedCommands.length).toBe(1);
    expect(recordedCommands[0]).toContain("rm --");
    expect(recordedCommands[0]).toContain("'/test/old file.ts'");
  });
});
