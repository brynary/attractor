import { describe, test, expect } from "bun:test";
import { StubAdapter } from "unified-llm/tests/stubs/stub-adapter.js";
import { Client, Role } from "unified-llm";
import type { Response as LLMResponse } from "unified-llm";
import { Session } from "../../src/session/session.js";
import { createAnthropicProfile } from "../../src/profiles/anthropic-profile.js";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import { EventKind, SessionState } from "../../src/types/index.js";
import type { SessionEvent } from "../../src/types/index.js";

describe("integration smoke test", () => {
  test("end-to-end: submit task, tool calls, completion", async () => {
    const files = new Map([
      ["/test/app.ts", 'export function greet() {\n  return "hello";\n}\n'],
    ]);

    // Stub sequence: 1) read_file, 2) edit_file, 3) final text
    const responses: LLMResponse[] = [
      {
        id: "resp-1",
        model: "test-model",
        provider: "anthropic",
        message: {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: {
                id: "tc1",
                name: "read_file",
                arguments: { file_path: "/test/app.ts" },
              },
            },
          ],
        },
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        warnings: [],
      },
      {
        id: "resp-2",
        model: "test-model",
        provider: "anthropic",
        message: {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "tool_call",
              toolCall: {
                id: "tc2",
                name: "write_file",
                arguments: {
                  file_path: "/test/app.ts",
                  content: 'export function greet() {\n  return "hi";\n}\n',
                },
              },
            },
          ],
        },
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
        warnings: [],
      },
      {
        id: "resp-3",
        model: "test-model",
        provider: "anthropic",
        message: {
          role: Role.ASSISTANT,
          content: [
            {
              kind: "text",
              text: 'I updated the greet function to return "hi" instead of "hello".',
            },
          ],
        },
        finishReason: { reason: "stop" },
        usage: { inputTokens: 300, outputTokens: 30, totalTokens: 330 },
        warnings: [],
      },
    ];

    const adapter = new StubAdapter(
      "anthropic",
      responses.map((r) => ({ response: r })),
    );
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment({ files });

    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    // Collect events
    const allEvents: SessionEvent[] = [];
    const eventGen = session.events();
    const eventCollector = (async () => {
      for await (const event of eventGen) {
        allEvents.push(event);
        if (event.kind === EventKind.INPUT_COMPLETE) break;
      }
    })();

    await session.submit("Change the greeting to hi");
    await eventCollector;

    // Verify final state
    expect(session.state).toBe(SessionState.IDLE);

    // Verify history structure
    // user, assistant(tc1), tool_results, assistant(tc2), tool_results, assistant(text)
    expect(session.history).toHaveLength(6);
    expect(session.history[0]?.kind).toBe("user");
    expect(session.history[1]?.kind).toBe("assistant");
    expect(session.history[2]?.kind).toBe("tool_results");
    expect(session.history[3]?.kind).toBe("assistant");
    expect(session.history[4]?.kind).toBe("tool_results");
    expect(session.history[5]?.kind).toBe("assistant");

    // Verify tool results
    if (session.history[2]?.kind === "tool_results") {
      expect(session.history[2].results[0]?.isError).toBe(false);
    }
    if (session.history[4]?.kind === "tool_results") {
      expect(session.history[4].results[0]?.isError).toBe(false);
    }

    // Verify file was written
    const updatedContent = await env.readFile("/test/app.ts");
    expect(updatedContent).toContain("hi");

    // Verify events (SESSION_START is emitted during construction before
    // events() consumer is registered, so we don't expect it here)
    const eventKinds = allEvents.map((e) => e.kind);
    expect(eventKinds).toContain(EventKind.USER_INPUT);
    expect(eventKinds).toContain(EventKind.TOOL_CALL_START);
    expect(eventKinds).toContain(EventKind.TOOL_CALL_END);
    expect(eventKinds).toContain(EventKind.ASSISTANT_TEXT_END);
    expect(eventKinds).toContain(EventKind.INPUT_COMPLETE);

    // Verify 3 LLM calls were made
    expect(adapter.calls).toHaveLength(3);
  });
});
