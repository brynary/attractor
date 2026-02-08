import { describe, test, expect } from "bun:test";
import { ReadOnlyExecutionEnvironment } from "../../src/env/readonly-env.js";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";

function createReadOnly(): ReadOnlyExecutionEnvironment {
  const inner = new StubExecutionEnvironment({
    files: new Map([
      ["hello.txt", "hello world"],
      ["src/main.ts", "console.log('hi')"],
    ]),
  });
  return new ReadOnlyExecutionEnvironment(inner);
}

describe("ReadOnlyExecutionEnvironment", () => {
  test("readFile delegates to inner", async () => {
    const env = createReadOnly();

    const result = await env.readFile("hello.txt");

    expect(result).toContain("hello world");
  });

  test("fileExists delegates to inner", async () => {
    const env = createReadOnly();

    expect(await env.fileExists("hello.txt")).toBe(true);
    expect(await env.fileExists("missing.txt")).toBe(false);
  });

  test("listDirectory delegates to inner", async () => {
    const env = createReadOnly();

    const entries = await env.listDirectory("src/");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("main.ts");
  });

  test("grep delegates to inner", async () => {
    const env = createReadOnly();

    const result = await env.grep("hello", "hello.txt");

    expect(result).toContain("hello");
  });

  test("glob delegates to inner", async () => {
    const env = createReadOnly();

    const result = await env.glob("*.txt");

    expect(result).toContain("hello.txt");
  });

  test("workingDirectory delegates to inner", () => {
    const env = createReadOnly();

    expect(env.workingDirectory()).toBe("/test");
  });

  test("platform delegates to inner", () => {
    const env = createReadOnly();

    expect(env.platform()).toBe("darwin");
  });

  test("osVersion delegates to inner", () => {
    const env = createReadOnly();

    expect(env.osVersion()).toBe("Test 1.0");
  });

  test("initialize delegates to inner", async () => {
    const env = createReadOnly();

    await env.initialize();
    // should not throw
  });

  test("cleanup delegates to inner", async () => {
    const env = createReadOnly();

    await env.cleanup();
    // should not throw
  });

  test("writeFile throws with read-only error", async () => {
    const env = createReadOnly();

    await expect(env.writeFile("new.txt", "content")).rejects.toThrow(
      "Write operations are disabled in read-only mode",
    );
  });

  test("execCommand throws with read-only error", async () => {
    const env = createReadOnly();

    await expect(env.execCommand("echo hi", 5000)).rejects.toThrow(
      "Write operations are disabled in read-only mode",
    );
  });
});
