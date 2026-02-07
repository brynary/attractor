import { describe, test, expect } from "bun:test";
import type { ContentPart } from "../../src/types/content-part.js";
import {
  isTextPart,
  isImagePart,
  isAudioPart,
  isDocumentPart,
  isToolCallPart,
  isToolResultPart,
  isThinkingPart,
  isRedactedThinkingPart,
} from "../../src/types/content-part.js";

describe("type guards", () => {
  const textPart: ContentPart = { kind: "text", text: "hello" };
  const imagePart: ContentPart = {
    kind: "image",
    image: { url: "https://example.com/img.png" },
  };
  const audioPart: ContentPart = {
    kind: "audio",
    audio: { url: "https://example.com/audio.mp3" },
  };
  const documentPart: ContentPart = {
    kind: "document",
    document: { fileName: "test.pdf" },
  };
  const toolCallPart: ContentPart = {
    kind: "tool_call",
    toolCall: { id: "1", name: "test", arguments: {} },
  };
  const toolResultPart: ContentPart = {
    kind: "tool_result",
    toolResult: { toolCallId: "1", content: "result", isError: false },
  };
  const thinkingPart: ContentPart = {
    kind: "thinking",
    thinking: { text: "Let me think...", redacted: false },
  };
  const redactedThinkingPart: ContentPart = {
    kind: "redacted_thinking",
    thinking: { text: "", redacted: true },
  };

  test("isTextPart identifies text parts", () => {
    expect(isTextPart(textPart)).toBe(true);
    expect(isTextPart(imagePart)).toBe(false);
  });

  test("isImagePart identifies image parts", () => {
    expect(isImagePart(imagePart)).toBe(true);
    expect(isImagePart(textPart)).toBe(false);
  });

  test("isAudioPart identifies audio parts", () => {
    expect(isAudioPart(audioPart)).toBe(true);
    expect(isAudioPart(textPart)).toBe(false);
  });

  test("isDocumentPart identifies document parts", () => {
    expect(isDocumentPart(documentPart)).toBe(true);
    expect(isDocumentPart(textPart)).toBe(false);
  });

  test("isToolCallPart identifies tool call parts", () => {
    expect(isToolCallPart(toolCallPart)).toBe(true);
    expect(isToolCallPart(textPart)).toBe(false);
  });

  test("isToolResultPart identifies tool result parts", () => {
    expect(isToolResultPart(toolResultPart)).toBe(true);
    expect(isToolResultPart(textPart)).toBe(false);
  });

  test("isThinkingPart identifies thinking parts", () => {
    expect(isThinkingPart(thinkingPart)).toBe(true);
    expect(isThinkingPart(redactedThinkingPart)).toBe(false);
  });

  test("isRedactedThinkingPart identifies redacted thinking parts", () => {
    expect(isRedactedThinkingPart(redactedThinkingPart)).toBe(true);
    expect(isRedactedThinkingPart(thinkingPart)).toBe(false);
  });

  test("type narrowing works with type guards", () => {
    if (isTextPart(textPart)) {
      expect(textPart.text).toBe("hello");
    }
    if (isToolCallPart(toolCallPart)) {
      expect(toolCallPart.toolCall.name).toBe("test");
    }
  });
});
