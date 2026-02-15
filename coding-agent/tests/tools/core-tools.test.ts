import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
} from "../../src/tools/core-tools.js";

describe("read_file", () => {
  test("reads file and returns line-numbered content", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/hello.txt", "hello\nworld"]]),
    });
    const tool = createReadFileTool();
    const result = await tool.executor({ file_path: "/test/hello.txt" }, env);
    expect(result).toContain("  1 | hello");
    expect(result).toContain("  2 | world");
  });

  test("passes offset and limit through", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/big.txt", lines.join("\n")]]),
    });
    const tool = createReadFileTool();
    const result = await tool.executor(
      { file_path: "/test/big.txt", offset: 2, limit: 3 },
      env,
    );
    expect(result).toContain("  2 | line 1");
    expect(result).toContain("  3 | line 2");
    expect(result).toContain("  4 | line 3");
    expect(result).not.toContain("line 0");
    expect(result).not.toContain("line 4");
  });

  test("defaults to 2000 lines when limit is omitted", async () => {
    const lines = Array.from({ length: 2505 }, (_, i) => `line ${i + 1}`);
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/huge.txt", lines.join("\n")]]),
    });
    const tool = createReadFileTool();
    const result = await tool.executor({ file_path: "/test/huge.txt" }, env);

    expect(result).toContain("2000 | line 2000");
    expect(result).not.toContain("line 2001");
  });

  test("throws on nonexistent file", async () => {
    const env = new StubExecutionEnvironment();
    const tool = createReadFileTool();
    await expect(
      tool.executor({ file_path: "/no/such/file" }, env),
    ).rejects.toThrow("File not found");
  });

  test("returns base64 data URI for small image file", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/icon.png", "PNG_BINARY_DATA"]]),
      commandResults: new Map([
        ["wc -c < '/test/icon.png'", {
          stdout: "100\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 5,
        }],
        ["base64 < '/test/icon.png'", {
          stdout: "UFNHX0JJTkFSWV9EQVRB\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 5,
        }],
      ]),
    });
    const tool = createReadFileTool();
    const result = await tool.executor({ file_path: "/test/icon.png" }, env);
    expect(result).toBe("data:image/png;base64,UFNHX0JJTkFSWV9EQVRB");
  });

  test("returns descriptive message for large image file", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/big.jpg", "LARGE_IMAGE"]]),
      commandResults: new Map([
        ["wc -c < '/test/big.jpg'", {
          stdout: "2000000\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 5,
        }],
      ]),
    });
    const tool = createReadFileTool();
    const result = await tool.executor({ file_path: "/test/big.jpg" }, env);
    expect(result).toContain("Image file: /test/big.jpg");
    expect(result).toContain("2000000 bytes");
    expect(result).toContain("Use the shell tool to process this image if needed.");
  });

  test("throws for nonexistent image file", async () => {
    const env = new StubExecutionEnvironment();
    const tool = createReadFileTool();
    await expect(
      tool.executor({ file_path: "/test/missing.png" }, env),
    ).rejects.toThrow("File not found");
  });

  test("detects all supported image extensions", async () => {
    const extensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];
    const tool = createReadFileTool();

    const results = await Promise.all(
      extensions.map(async (ext) => {
        const path = `/test/image${ext}`;
        const env = new StubExecutionEnvironment({
          files: new Map([[path, "data"]]),
          commandResults: new Map([
            [`wc -c < '${path}'`, {
              stdout: "50\n",
              stderr: "",
              exitCode: 0,
              timedOut: false,
              durationMs: 5,
            }],
            [`base64 < '${path}'`, {
              stdout: "AAAA\n",
              stderr: "",
              exitCode: 0,
              timedOut: false,
              durationMs: 5,
            }],
          ]),
        });
        return tool.executor({ file_path: path }, env);
      }),
    );

    expect(results.every((r) => r.startsWith("data:"))).toBe(true);
  });
});

describe("write_file", () => {
  test("writes content and returns confirmation with byte count", async () => {
    const env = new StubExecutionEnvironment();
    const tool = createWriteFileTool();
    const result = await tool.executor(
      { file_path: "/test/out.txt", content: "hello world" },
      env,
    );
    expect(result).toBe("Wrote 11 bytes to /test/out.txt");
    expect(await env.fileExists("/test/out.txt")).toBe(true);
  });

  test("reports correct byte count for multi-byte characters", async () => {
    const env = new StubExecutionEnvironment();
    const tool = createWriteFileTool();
    // The emoji takes 4 bytes in UTF-8, so total is 4 not 2 (.length)
    const content = "\u{1F600}"; // grinning face emoji
    const result = await tool.executor(
      { file_path: "/test/emoji.txt", content },
      env,
    );
    expect(result).toBe("Wrote 4 bytes to /test/emoji.txt");
  });
});

describe("edit_file", () => {
  test("replaces old_string with new_string", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "const x = 1;\nconst y = 2;"]]),
    });
    const tool = createEditFileTool();
    const result = await tool.executor(
      {
        file_path: "/test/file.ts",
        old_string: "const x = 1;",
        new_string: "const x = 42;",
      },
      env,
    );
    expect(result).toContain("Replaced 1 occurrence(s)");

    const content = await env.readFile("/test/file.ts");
    expect(content).toContain("const x = 42;");
    expect(content).toContain("const y = 2;");
  });

  test("throws when old_string not found", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "const x = 1;"]]),
    });
    const tool = createEditFileTool();
    await expect(
      tool.executor(
        {
          file_path: "/test/file.ts",
          old_string: "not found",
          new_string: "replacement",
        },
        env,
      ),
    ).rejects.toThrow("old_string not found");
  });

  test("throws when old_string not unique and replace_all is false", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "foo\nfoo\nbar"]]),
    });
    const tool = createEditFileTool();
    await expect(
      tool.executor(
        {
          file_path: "/test/file.ts",
          old_string: "foo",
          new_string: "baz",
        },
        env,
      ),
    ).rejects.toThrow("old_string is not unique");
  });

  test("replaces all occurrences when replace_all is true", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "foo\nfoo\nbar"]]),
    });
    const tool = createEditFileTool();
    const result = await tool.executor(
      {
        file_path: "/test/file.ts",
        old_string: "foo",
        new_string: "baz",
        replace_all: true,
      },
      env,
    );
    expect(result).toContain("Replaced 2 occurrence(s)");

    const content = await env.readFile("/test/file.ts");
    expect(content).not.toContain("foo");
    expect(content).toContain("baz");
  });

  test("falls back to fuzzy matching when whitespace differs", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "const  x  =  1;\nconst y = 2;"]]),
    });
    const tool = createEditFileTool();
    const result = await tool.executor(
      {
        file_path: "/test/file.ts",
        old_string: "const x = 1;",
        new_string: "const x = 42;",
      },
      env,
    );
    expect(result).toContain("fuzzy match");

    const content = await env.readFile("/test/file.ts");
    expect(content).toContain("const x = 42;");
    expect(content).toContain("const y = 2;");
  });

  test("fuzzy match replaces all occurrences when replace_all is true", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "const  x  =  1;\nconst  x  =  1;\nconst y = 2;"]]),
    });
    const tool = createEditFileTool();
    const result = await tool.executor(
      {
        file_path: "/test/file.ts",
        old_string: "const x = 1;",
        new_string: "const x = 42;",
        replace_all: true,
      },
      env,
    );
    expect(result).toContain("Replaced 2 occurrence(s)");
    expect(result).toContain("fuzzy match");

    const content = await env.readFile("/test/file.ts");
    expect(content).not.toContain("const  x  =  1;");
    expect(content).toContain("const y = 2;");
  });

  test("falls back to fuzzy matching when Unicode punctuation differs", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "const msg = \u201Chello world\u201D;\nconst y = 2;"]]),
    });
    const tool = createEditFileTool();
    const result = await tool.executor(
      {
        file_path: "/test/file.ts",
        old_string: 'const msg = "hello world";',
        new_string: 'const msg = "goodbye world";',
      },
      env,
    );
    expect(result).toContain("fuzzy match");

    const content = await env.readFile("/test/file.ts");
    expect(content).toContain('const msg = "goodbye world";');
    expect(content).toContain("const y = 2;");
  });

  test("fuzzy match throws when neither exact nor normalized match found", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/file.ts", "const x = 1;"]]),
    });
    const tool = createEditFileTool();
    await expect(
      tool.executor(
        {
          file_path: "/test/file.ts",
          old_string: "totally different",
          new_string: "replacement",
        },
        env,
      ),
    ).rejects.toThrow("old_string not found");
  });
});

describe("shell", () => {
  test("executes command and returns formatted output", async () => {
    const env = new StubExecutionEnvironment({
      commandResults: new Map([
        [
          "echo hello",
          {
            stdout: "hello\n",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            durationMs: 50,
          },
        ],
      ]),
    });
    const tool = createShellTool({
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 600000,
    });
    const result = await tool.executor({ command: "echo hello" }, env);
    expect(result).toContain("hello");
    expect(result).toContain("[exit code: 0]");
    expect(result).toContain("[duration: 50ms]");
  });

  test("includes timeout warning when command times out", async () => {
    const env = new StubExecutionEnvironment({
      commandResults: new Map([
        [
          "sleep 999",
          {
            stdout: "partial",
            stderr: "",
            exitCode: 1,
            timedOut: true,
            durationMs: 10000,
          },
        ],
      ]),
    });
    const tool = createShellTool({
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 600000,
    });
    const result = await tool.executor({ command: "sleep 999" }, env);
    expect(result).toContain("Command timed out after 10000ms. Partial output is shown above.\nYou can retry");
    expect(result).toContain("partial");
  });

  test("respects custom timeout_ms parameter", async () => {
    const env = new StubExecutionEnvironment({
      defaultExecResult: {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 100,
      },
    });
    const tool = createShellTool({
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 600000,
    });
    // We can't directly observe the timeout passed to execCommand from the stub,
    // but we verify the tool doesn't error with a custom timeout
    const result = await tool.executor(
      { command: "test", timeout_ms: 30000 },
      env,
    );
    expect(result).toContain("[exit code: 0]");
  });

  test("returns abort error when signal is already aborted", async () => {
    const env = new StubExecutionEnvironment({
      defaultExecResult: {
        stdout: "should not run",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      },
    });
    const tool = createShellTool({
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 600000,
    });
    const controller = new AbortController();
    controller.abort();
    const result = await tool.executor(
      { command: "echo hello" },
      env,
      controller.signal,
    );
    expect(result).toContain("Command aborted before execution");
  });

  test("receives abort signal parameter", async () => {
    const env = new StubExecutionEnvironment({
      defaultExecResult: {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 10,
      },
    });
    const tool = createShellTool({
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 600000,
    });
    const controller = new AbortController();
    const result = await tool.executor(
      { command: "echo ok" },
      env,
      controller.signal,
    );
    expect(result).toContain("[exit code: 0]");
  });

  test("uses spec defaults when no config provided", async () => {
    const env = new StubExecutionEnvironment({
      commandResults: new Map([
        [
          "echo hi",
          {
            stdout: "hi\n",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            durationMs: 10,
          },
        ],
      ]),
    });
    const tool = createShellTool();
    const result = await tool.executor({ command: "echo hi" }, env);
    expect(result).toContain("[exit code: 0]");
  });

  test("caps timeout at maxTimeoutMs", async () => {
    const env = new StubExecutionEnvironment({
      commandResults: new Map([
        [
          "long-cmd",
          {
            stdout: "",
            stderr: "",
            exitCode: 0,
            timedOut: true,
            durationMs: 5000,
          },
        ],
      ]),
    });
    const tool = createShellTool({
      defaultTimeoutMs: 10000,
      maxTimeoutMs: 5000,
    });
    const result = await tool.executor(
      { command: "long-cmd", timeout_ms: 999999 },
      env,
    );
    // Should be capped to 5000
    expect(result).toContain("Command timed out after 5000ms");
  });
});

describe("grep", () => {
  test("returns matching lines", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/a.ts", "const hello = 1;\nconst world = 2;"],
        ["/test/b.ts", "hello there"],
      ]),
    });
    const tool = createGrepTool();
    const result = await tool.executor({ pattern: "hello" }, env);
    expect(result).toContain("hello");
    expect(result).toContain("/test/a.ts");
    expect(result).toContain("/test/b.ts");
  });

  test("output_mode files_with_matches returns only file paths", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/a.ts", "const hello = 1;\nconst hello = 2;"],
        ["/test/b.ts", "hello there"],
      ]),
    });
    const tool = createGrepTool();
    const result = await tool.executor(
      { pattern: "hello", output_mode: "files_with_matches" },
      env,
    );
    expect(result).toContain("/test/a.ts");
    expect(result).toContain("/test/b.ts");
    // Should not contain line numbers or content
    expect(result).not.toContain(":1:");
    expect(result).not.toContain("const");
  });

  test("output_mode count returns match counts per file", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/a.ts", "hello\nhello\nworld"],
        ["/test/b.ts", "hello there"],
      ]),
    });
    const tool = createGrepTool();
    const result = await tool.executor(
      { pattern: "hello", output_mode: "count" },
      env,
    );
    expect(result).toContain("/test/a.ts:2");
    expect(result).toContain("/test/b.ts:1");
  });
});

describe("glob", () => {
  test("returns matching files", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/src/a.ts", ""],
        ["/test/src/b.ts", ""],
        ["/test/src/c.js", ""],
      ]),
    });
    const tool = createGlobTool();
    const result = await tool.executor({ pattern: "**/*.ts" }, env);
    expect(result).toContain("/test/src/a.ts");
    expect(result).toContain("/test/src/b.ts");
    expect(result).not.toContain("c.js");
  });
});
