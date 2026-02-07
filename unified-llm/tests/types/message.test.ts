import { describe, test, expect } from "bun:test";
import {
  systemMessage,
  userMessage,
  assistantMessage,
  toolResultMessage,
  messageText,
} from "../../src/types/message.js";
import { Role } from "../../src/types/role.js";

describe("systemMessage", () => {
  test("creates a system message with text content", () => {
    const msg = systemMessage("You are a helpful assistant");
    expect(msg.role).toBe(Role.SYSTEM);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({
      kind: "text",
      text: "You are a helpful assistant",
    });
  });
});

describe("userMessage", () => {
  test("creates a user message with text content", () => {
    const msg = userMessage("Hello");
    expect(msg.role).toBe(Role.USER);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({ kind: "text", text: "Hello" });
  });
});

describe("assistantMessage", () => {
  test("creates an assistant message with text content", () => {
    const msg = assistantMessage("Hi there");
    expect(msg.role).toBe(Role.ASSISTANT);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({ kind: "text", text: "Hi there" });
  });
});

describe("toolResultMessage", () => {
  test("creates a tool result message", () => {
    const msg = toolResultMessage("call-1", "result data");
    expect(msg.role).toBe(Role.TOOL);
    expect(msg.toolCallId).toBe("call-1");
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({
      kind: "tool_result",
      toolResult: {
        toolCallId: "call-1",
        content: "result data",
        isError: false,
      },
    });
  });

  test("creates a tool result message with error", () => {
    const msg = toolResultMessage("call-2", "something went wrong", true);
    expect(msg.content[0]).toEqual({
      kind: "tool_result",
      toolResult: {
        toolCallId: "call-2",
        content: "something went wrong",
        isError: true,
      },
    });
  });
});

describe("messageText", () => {
  test("concatenates all text parts", () => {
    const msg = {
      role: Role.ASSISTANT,
      content: [
        { kind: "text" as const, text: "Hello " },
        { kind: "text" as const, text: "world" },
      ],
    };
    expect(messageText(msg)).toBe("Hello world");
  });

  test("ignores non-text parts", () => {
    const msg = {
      role: Role.ASSISTANT,
      content: [
        { kind: "text" as const, text: "Hello" },
        {
          kind: "tool_call" as const,
          toolCall: {
            id: "1",
            name: "test",
            arguments: {},
          },
        },
        { kind: "text" as const, text: " world" },
      ],
    };
    expect(messageText(msg)).toBe("Hello world");
  });

  test("returns empty string when no text parts", () => {
    const msg = {
      role: Role.ASSISTANT,
      content: [],
    };
    expect(messageText(msg)).toBe("");
  });
});
