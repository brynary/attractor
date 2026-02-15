import { describe, test, expect } from "bun:test";
import {
  extractToolCallSignatures,
  detectLoop,
} from "../../src/session/loop-detection.js";
import type { AssistantTurn, ToolResultsTurn, Turn } from "../../src/types/session.js";

function makeAssistantTurn(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): AssistantTurn {
  return {
    kind: "assistant",
    content: "",
    toolCalls: toolCalls.map((tc, i) => ({
      id: `call-${i}`,
      name: tc.name,
      arguments: tc.arguments,
    })),
    reasoning: null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    responseId: null,
    timestamp: new Date(),
  };
}

function makeToolResultsTurn(): ToolResultsTurn {
  return {
    kind: "tool_results",
    results: [],
    timestamp: new Date(),
  };
}

describe("extractToolCallSignatures", () => {
  test("extracts from assistant turns in order", () => {
    const history: Turn[] = [
      makeAssistantTurn([{ name: "read_file", arguments: { path: "a.ts" } }]),
      makeToolResultsTurn(),
      makeAssistantTurn([{ name: "edit_file", arguments: { path: "b.ts" } }]),
    ];
    const sigs = extractToolCallSignatures(history, 10);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]?.startsWith("read_file:")).toBe(true);
    expect(sigs[1]?.startsWith("edit_file:")).toBe(true);
  });

  test("skips non-assistant turns", () => {
    const history: Turn[] = [
      { kind: "user", content: "hello", timestamp: new Date() },
      makeAssistantTurn([{ name: "shell", arguments: { cmd: "ls" } }]),
      makeToolResultsTurn(),
      { kind: "system", content: "note", timestamp: new Date() },
    ];
    const sigs = extractToolCallSignatures(history, 10);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]?.startsWith("shell:")).toBe(true);
  });

  test("limits to requested count", () => {
    const history: Turn[] = [
      makeAssistantTurn([
        { name: "read_file", arguments: { path: "a.ts" } },
        { name: "read_file", arguments: { path: "b.ts" } },
      ]),
      makeToolResultsTurn(),
      makeAssistantTurn([
        { name: "edit_file", arguments: { path: "c.ts" } },
      ]),
    ];
    const sigs = extractToolCallSignatures(history, 2);
    // Should get the 2 most recent, then reverse to chronological
    expect(sigs).toHaveLength(2);
    expect(sigs[0]?.startsWith("read_file:")).toBe(true);
    expect(sigs[1]?.startsWith("edit_file:")).toBe(true);
  });

  test("uses a stable hash for arguments regardless of key order", () => {
    const history: Turn[] = [
      makeAssistantTurn([{ name: "shell", arguments: { b: 2, a: 1 } }]),
      makeToolResultsTurn(),
      makeAssistantTurn([{ name: "shell", arguments: { a: 1, b: 2 } }]),
    ];
    const sigs = extractToolCallSignatures(history, 2);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toBe(sigs[1]);
  });
});

describe("detectLoop", () => {
  test("pattern of length 1 (same call repeated) is detected", () => {
    const call = { name: "read_file", arguments: { path: "x.ts" } };
    const history: Turn[] = [];
    for (let i = 0; i < 5; i++) {
      history.push(makeAssistantTurn([call]));
      history.push(makeToolResultsTurn());
    }
    expect(detectLoop(history, 5)).toBe(true);
  });

  test("pattern of length 2 (A,B,A,B,...) is detected", () => {
    const callA = { name: "read_file", arguments: { path: "a.ts" } };
    const callB = { name: "edit_file", arguments: { path: "b.ts" } };
    const history: Turn[] = [];
    for (let i = 0; i < 3; i++) {
      history.push(makeAssistantTurn([callA]));
      history.push(makeToolResultsTurn());
      history.push(makeAssistantTurn([callB]));
      history.push(makeToolResultsTurn());
    }
    // 6 calls, windowSize=6, pattern len 2 divides 6
    expect(detectLoop(history, 6)).toBe(true);
  });

  test("pattern of length 3 (A,B,C,A,B,C) is detected", () => {
    const callA = { name: "read_file", arguments: { path: "a.ts" } };
    const callB = { name: "edit_file", arguments: { path: "b.ts" } };
    const callC = { name: "shell", arguments: { cmd: "test" } };
    const history: Turn[] = [];
    for (let i = 0; i < 2; i++) {
      history.push(makeAssistantTurn([callA]));
      history.push(makeToolResultsTurn());
      history.push(makeAssistantTurn([callB]));
      history.push(makeToolResultsTurn());
      history.push(makeAssistantTurn([callC]));
      history.push(makeToolResultsTurn());
    }
    expect(detectLoop(history, 6)).toBe(true);
  });

  test("short history (fewer than window) returns false", () => {
    const history: Turn[] = [
      makeAssistantTurn([{ name: "read_file", arguments: { path: "a.ts" } }]),
      makeToolResultsTurn(),
    ];
    expect(detectLoop(history, 5)).toBe(false);
  });

  test("no pattern (all different calls) returns false", () => {
    const history: Turn[] = [];
    for (let i = 0; i < 5; i++) {
      history.push(
        makeAssistantTurn([{ name: "read_file", arguments: { path: `${i}.ts` } }]),
      );
      history.push(makeToolResultsTurn());
    }
    expect(detectLoop(history, 5)).toBe(false);
  });

  test("almost-pattern (one call differs) returns false", () => {
    const call = { name: "read_file", arguments: { path: "x.ts" } };
    const differentCall = { name: "read_file", arguments: { path: "y.ts" } };
    const history: Turn[] = [];
    for (let i = 0; i < 4; i++) {
      history.push(makeAssistantTurn([call]));
      history.push(makeToolResultsTurn());
    }
    // Replace one with a different call
    history.push(makeAssistantTurn([differentCall]));
    history.push(makeToolResultsTurn());
    expect(detectLoop(history, 5)).toBe(false);
  });

  test("window size not divisible by pattern length skips that pattern", () => {
    // Window of 5: not divisible by 2 or 3, only by 1
    // A,B,A,B,A — pattern len 2 doesn't divide 5, so not checked
    // But pattern len 1 doesn't match (A != B)
    const callA = { name: "read_file", arguments: { path: "a.ts" } };
    const callB = { name: "edit_file", arguments: { path: "b.ts" } };
    const history: Turn[] = [
      makeAssistantTurn([callA]),
      makeToolResultsTurn(),
      makeAssistantTurn([callB]),
      makeToolResultsTurn(),
      makeAssistantTurn([callA]),
      makeToolResultsTurn(),
      makeAssistantTurn([callB]),
      makeToolResultsTurn(),
      makeAssistantTurn([callA]),
      makeToolResultsTurn(),
    ];
    // windowSize=5, not divisible by 2, so A,B pattern not checked
    expect(detectLoop(history, 5)).toBe(false);
  });
});
