import { describe, test, expect } from "bun:test";
import { LoggingExecutionEnvironment, type LogEntry } from "../../src/env/logging-env.js";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";

function createLogged(): { env: LoggingExecutionEnvironment; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const inner = new StubExecutionEnvironment({
    files: new Map([
      ["hello.txt", "hello world"],
      ["src/main.ts", "console.log('hi')"],
    ]),
  });
  const env = new LoggingExecutionEnvironment(inner, (entry) => entries.push(entry));
  return { env, entries };
}

describe("LoggingExecutionEnvironment", () => {
  test("readFile delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    const result = await env.readFile("hello.txt");

    expect(result).toContain("hello world");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("readFile");
    expect(entries[0]?.args).toEqual(["hello.txt", undefined, undefined]);
    expect(entries[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(entries[0]?.error).toBeUndefined();
  });

  test("writeFile delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    await env.writeFile("new.txt", "content");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("writeFile");
    expect(entries[0]?.args).toEqual(["new.txt", "content"]);
  });

  test("fileExists delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    const exists = await env.fileExists("hello.txt");

    expect(exists).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("fileExists");
  });

  test("listDirectory delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    const result = await env.listDirectory("src/");

    expect(result).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("listDirectory");
  });

  test("execCommand delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    const result = await env.execCommand("echo hi", 5000);

    expect(result.exitCode).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("execCommand");
    expect(entries[0]?.args).toEqual(["echo hi", 5000, undefined]);
  });

  test("grep delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    await env.grep("hello", "hello.txt");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("grep");
  });

  test("glob delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    await env.glob("*.txt");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("glob");
  });

  test("initialize delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    await env.initialize();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("initialize");
  });

  test("cleanup delegates to inner and logs the call", async () => {
    const { env, entries } = createLogged();

    await env.cleanup();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("cleanup");
  });

  test("workingDirectory delegates to inner without logging", () => {
    const { env, entries } = createLogged();

    const result = env.workingDirectory();

    expect(result).toBe("/test");
    expect(entries).toHaveLength(0);
  });

  test("platform delegates to inner without logging", () => {
    const { env, entries } = createLogged();

    const result = env.platform();

    expect(result).toBe("darwin");
    expect(entries).toHaveLength(0);
  });

  test("osVersion delegates to inner without logging", () => {
    const { env, entries } = createLogged();

    const result = env.osVersion();

    expect(result).toBe("Test 1.0");
    expect(entries).toHaveLength(0);
  });

  test("logs error when inner throws", async () => {
    const { env, entries } = createLogged();

    await expect(env.readFile("nonexistent.txt")).rejects.toThrow("File not found");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.method).toBe("readFile");
    expect(entries[0]?.error).toBeInstanceOf(Error);
    expect(entries[0]?.error?.message).toContain("File not found");
  });
});
