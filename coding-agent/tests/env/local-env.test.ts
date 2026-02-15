import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalExecutionEnvironment } from "../../src/env/local-env.js";

let tempDir: string;
let env: LocalExecutionEnvironment;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "coding-agent-test-"));
  env = new LocalExecutionEnvironment({ workingDir: tempDir });
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("LocalExecutionEnvironment", () => {
  test("readFile returns formatted lines with line numbers", async () => {
    const content = "line one\nline two\nline three\n";
    await fsWriteFile(join(tempDir, "read-test.txt"), content);

    const result = await env.readFile("read-test.txt");

    expect(result).toContain("1 | line one");
    expect(result).toContain("2 | line two");
    expect(result).toContain("3 | line three");
  });

  test("readFile with offset and limit returns only requested lines", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await fsWriteFile(join(tempDir, "offset-test.txt"), lines.join("\n"));

    // offset is 1-based; get lines 3-5
    const result = await env.readFile("offset-test.txt", 3, 3);

    expect(result).toContain("line 3");
    expect(result).toContain("line 4");
    expect(result).toContain("line 5");
    expect(result).not.toContain("line 2");
    expect(result).not.toContain("line 6");
  });

  test("readFile without limit reads full file (not capped at 2000 lines)", async () => {
    const lines = Array.from({ length: 2505 }, (_, i) => `line ${i + 1}`);
    await fsWriteFile(join(tempDir, "full-read-test.txt"), lines.join("\n"));

    const result = await env.readFile("full-read-test.txt");

    expect(result).toContain("2505 | line 2505");
  });

  test("readFile throws for nonexistent file", async () => {
    await expect(env.readFile("does-not-exist.txt")).rejects.toThrow(
      "File not found",
    );
  });

  test("readFile throws for binary files", async () => {
    await fsWriteFile(
      join(tempDir, "binary.bin"),
      Buffer.from([0x00, 0xff, 0x10, 0x00, 0x41]),
    );

    await expect(env.readFile("binary.bin")).rejects.toThrow("Binary file");
  });

  test("writeFile creates a file with correct content", async () => {
    await env.writeFile("write-test.txt", "hello world");

    const file = Bun.file(join(tempDir, "write-test.txt"));
    const text = await file.text();
    expect(text).toBe("hello world");
  });

  test("writeFile creates parent directories", async () => {
    await env.writeFile("nested/dir/file.txt", "nested content");

    const file = Bun.file(join(tempDir, "nested/dir/file.txt"));
    expect(await file.exists()).toBe(true);
    expect(await file.text()).toBe("nested content");
  });

  test("fileExists returns true for existing file", async () => {
    await fsWriteFile(join(tempDir, "exists-test.txt"), "hi");

    expect(await env.fileExists("exists-test.txt")).toBe(true);
  });

  test("fileExists returns false for nonexistent file", async () => {
    expect(await env.fileExists("nope.txt")).toBe(false);
  });

  test("listDirectory returns entries with correct properties", async () => {
    const subdir = join(tempDir, "list-test");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(subdir, { recursive: true });
    await fsWriteFile(join(subdir, "a.txt"), "aaa");
    await fsWriteFile(join(subdir, "b.txt"), "bbb");
    await mkdir(join(subdir, "subdir"), { recursive: true });

    const entries = await env.listDirectory("list-test");

    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("subdir");

    const fileEntry = entries.find((e) => e.name === "a.txt");
    expect(fileEntry?.isDir).toBe(false);
    expect(fileEntry?.size).toBe(3);

    const dirEntry = entries.find((e) => e.name === "subdir");
    expect(dirEntry?.isDir).toBe(true);
    expect(dirEntry?.size).toBeNull();
  });

  test("execCommand runs a command and captures stdout", async () => {
    const result = await env.execCommand("echo hello", 5000);

    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("execCommand captures non-zero exit code", async () => {
    const result = await env.execCommand("exit 1", 5000);

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  test("execCommand handles timeout", async () => {
    const result = await env.execCommand("sleep 10", 500);

    expect(result.timedOut).toBe(true);
  });

  test("execCommand kills child processes on timeout", async () => {
    // Spawn a command that creates a child process writing to a temp file
    const markerFile = join(tempDir, "child-alive-marker");
    // The child process writes to the marker file in a loop;
    // after timeout + kill, the marker file should stop growing
    const cmd = `bash -c 'while true; do echo alive >> "${markerFile}"; sleep 0.1; done' &
wait`;
    const result = await env.execCommand(cmd, 500);
    expect(result.timedOut).toBe(true);

    // Wait a bit for the child to be cleaned up
    await new Promise((r) => setTimeout(r, 500));

    // Check that the child is no longer writing
    const { stat: fsStat } = await import("node:fs/promises");
    let size1: number;
    try {
      const s = await fsStat(markerFile);
      size1 = s.size;
    } catch {
      // File might not exist if child was killed fast enough
      size1 = 0;
    }

    await new Promise((r) => setTimeout(r, 300));

    let size2: number;
    try {
      const s = await fsStat(markerFile);
      size2 = s.size;
    } catch {
      size2 = 0;
    }

    // The file should not have grown (child process is dead)
    expect(size2).toBe(size1);
  });

  test("execCommand aborts a running command when abortSignal fires", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    const result = await env.execCommand("sleep 10", 30_000, undefined, undefined, controller.signal);
    const elapsed = Date.now() - start;

    // Should finish well under the 30s timeout
    expect(elapsed).toBeLessThan(5000);
    // The process was killed, so exit code is non-zero
    expect(result.exitCode).not.toBe(0);
    // It was not a timeout — abort is different from timeout
    expect(result.timedOut).toBe(false);
  });

  test("execCommand handles already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const start = Date.now();
    const result = await env.execCommand("sleep 10", 30_000, undefined, undefined, controller.signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("glob finds matching files", async () => {
    const globDir = join(tempDir, "glob-test");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(globDir, { recursive: true });
    await fsWriteFile(join(globDir, "foo.ts"), "ts file");
    await fsWriteFile(join(globDir, "bar.ts"), "ts file 2");
    await fsWriteFile(join(globDir, "baz.js"), "js file");

    const results = await env.glob("*.ts", "glob-test");

    expect(results.length).toBe(2);
    expect(results).toContain("foo.ts");
    expect(results).toContain("bar.ts");
  });

  test("platform returns a valid platform string", () => {
    const platform = env.platform();
    expect(typeof platform).toBe("string");
    expect(platform.length).toBeGreaterThan(0);
  });

  test("osVersion returns a non-empty string", () => {
    const version = env.osVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  test("workingDirectory returns the configured dir", () => {
    expect(env.workingDirectory()).toBe(tempDir);
  });
});
