import { describe, test, expect } from "bun:test";
import { injectCacheControl } from "../../../src/providers/anthropic/cache.js";

describe("Anthropic cache control injection", () => {
  test("injects cache_control on last system block", () => {
    const body = {
      system: [
        { type: "text" as const, text: "First" },
        { type: "text" as const, text: "Second" },
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
      ],
    };

    const result = injectCacheControl(body);
    const system = result.system as Array<Record<string, unknown>>;

    expect(system).toHaveLength(2);
    expect(system.at(0)?.cache_control).toBeUndefined();
    expect(system.at(1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  test("injects cache_control on last tool definition", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
      ],
      tools: [
        { name: "tool_a", input_schema: {} },
        { name: "tool_b", input_schema: {} },
      ],
    };

    const result = injectCacheControl(body);
    const tools = result.tools as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(2);
    expect(tools.at(0)?.cache_control).toBeUndefined();
    expect(tools.at(1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  test("injects cache_control on second-to-last message's last content block", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Response" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Follow up" }],
        },
      ],
    };

    const result = injectCacheControl(body);
    const messages = result.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;

    expect(messages).toHaveLength(3);

    const firstMsg = messages.at(0);
    expect(firstMsg?.content.at(0)?.cache_control).toBeUndefined();
    expect(firstMsg?.content.at(1)?.cache_control).toBeUndefined();

    const secondMsg = messages.at(1);
    expect(secondMsg?.content.at(0)?.cache_control).toEqual({
      type: "ephemeral",
    });

    const thirdMsg = messages.at(2);
    expect(thirdMsg?.content.at(0)?.cache_control).toBeUndefined();
  });

  test("handles all three injection points together", () => {
    const body = {
      system: [{ type: "text", text: "System" }],
      tools: [{ name: "my_tool", input_schema: {} }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "First" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Reply" }],
        },
      ],
    };

    const result = injectCacheControl(body);

    const system = result.system as Array<Record<string, unknown>>;
    expect(system.at(0)?.cache_control).toEqual({ type: "ephemeral" });

    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools.at(0)?.cache_control).toEqual({ type: "ephemeral" });

    const messages = result.messages as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    expect(messages.at(0)?.content.at(0)?.cache_control).toEqual({
      type: "ephemeral",
    });
  });

  test("does not modify original body", () => {
    const body = {
      system: [
        { type: "text" as const, text: "System", cache_control: undefined as unknown },
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
        { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      ],
    };

    injectCacheControl(body);

    expect(body.system.at(0)?.cache_control).toBeUndefined();
  });

  test("handles body with only one message (no second-to-last)", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
      ],
    };

    const result = injectCacheControl(body);
    const messages = result.messages as Array<{
      content: Array<Record<string, unknown>>;
    }>;

    expect(messages.at(0)?.content.at(0)?.cache_control).toBeUndefined();
  });
});
