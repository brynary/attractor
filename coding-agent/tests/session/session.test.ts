import { describe, test, expect } from "bun:test";
import { StubAdapter } from "unified-llm/tests/stubs/stub-adapter.js";
import { Client, Role } from "unified-llm";
import type { Response as LLMResponse, ToolCallData } from "unified-llm";
import { Session } from "../../src/session/session.js";
import { createAnthropicProfile } from "../../src/profiles/anthropic-profile.js";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import type { SessionEvent } from "../../src/types/index.js";
import { EventKind, SessionState } from "../../src/types/index.js";

function makeTextResponse(text: string): LLMResponse {
  return {
    id: "resp-1",
    model: "test-model",
    provider: "anthropic",
    message: { role: Role.ASSISTANT, content: [{ kind: "text", text }] },
    finishReason: { reason: "stop" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

function makeToolCallResponse(
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>,
): LLMResponse {
  return {
    id: "resp-tc",
    model: "test-model",
    provider: "anthropic",
    message: {
      role: Role.ASSISTANT,
      content: toolCalls.map((tc) => ({
        kind: "tool_call" as const,
        toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
      })),
    },
    finishReason: { reason: "tool_calls" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

function createTestSession(
  responses: LLMResponse[],
  options?: {
    files?: Map<string, string>;
    config?: Partial<import("../../src/types/index.js").SessionConfig>;
  },
): { session: Session; adapter: StubAdapter; env: StubExecutionEnvironment } {
  const adapter = new StubAdapter(
    "anthropic",
    responses.map((r) => ({ response: r })),
  );
  const client = new Client({ providers: { anthropic: adapter } });
  const profile = createAnthropicProfile("test-model");
  const env = new StubExecutionEnvironment({
    files: options?.files ?? new Map(),
  });
  const session = new Session({
    providerProfile: profile,
    executionEnv: env,
    llmClient: client,
    config: options?.config,
  });
  return { session, adapter, env };
}

async function collectEvents(
  session: Session,
  untilKind: string,
): Promise<SessionEvent[]> {
  const collected: SessionEvent[] = [];
  const gen = session.events();
  for await (const event of gen) {
    collected.push(event);
    if (event.kind === untilKind) break;
  }
  return collected;
}

describe("Session", () => {
  test("natural completion: text-only response", async () => {
    const { session } = createTestSession([makeTextResponse("Hello there")]);

    await session.submit("Hi");

    expect(session.state).toBe(SessionState.IDLE);
    expect(session.history).toHaveLength(2);
    expect(session.history[0]?.kind).toBe("user");
    expect(session.history[1]?.kind).toBe("assistant");
    if (session.history[1]?.kind === "assistant") {
      expect(session.history[1].content).toBe("Hello there");
      expect(session.history[1].toolCalls).toHaveLength(0);
    }
  });

  test("single tool round: tool call then text", async () => {
    const files = new Map([["/test/foo.ts", "export const x = 1;"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/foo.ts" },
          },
        ]),
        makeTextResponse("File contains x = 1"),
      ],
      { files },
    );

    await session.submit("Read foo.ts");

    expect(session.state).toBe(SessionState.IDLE);
    expect(session.history).toHaveLength(4);
    expect(session.history[0]?.kind).toBe("user");
    expect(session.history[1]?.kind).toBe("assistant");
    expect(session.history[2]?.kind).toBe("tool_results");
    expect(session.history[3]?.kind).toBe("assistant");

    if (session.history[2]?.kind === "tool_results") {
      expect(session.history[2].results).toHaveLength(1);
      expect(session.history[2].results[0]?.isError).toBe(false);
    }
  });

  test("multi-round tool loop: two tool calls then text", async () => {
    const files = new Map([
      ["/test/a.ts", "a"],
      ["/test/b.ts", "b"],
    ]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/a.ts" },
          },
        ]),
        makeToolCallResponse([
          {
            id: "tc2",
            name: "read_file",
            arguments: { file_path: "/test/b.ts" },
          },
        ]),
        makeTextResponse("Done reading both files"),
      ],
      { files },
    );

    await session.submit("Read both files");

    // user, assistant+tc, tool_results, assistant+tc, tool_results, assistant
    expect(session.history).toHaveLength(6);
    const assistantTurns = session.history.filter(
      (t) => t.kind === "assistant",
    );
    expect(assistantTurns).toHaveLength(3);
  });

  test("max rounds limit stops tool loop", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/x.ts" },
          },
        ]),
        makeToolCallResponse([
          {
            id: "tc2",
            name: "read_file",
            arguments: { file_path: "/test/x.ts" },
          },
        ]),
        makeTextResponse("should not reach"),
      ],
      { files, config: { maxToolRoundsPerInput: 1 } },
    );

    await session.submit("Keep reading");

    // user, assistant+tc, tool_results → then limit triggers
    // second LLM call produces tc2 but roundCount is already 1 so it breaks before executing
    // Actually: round 0 → LLM call → tc1 → execute → roundCount becomes 1
    // round 1 → check maxToolRoundsPerInput (1 >= 1) → TURN_LIMIT → break
    expect(session.history).toHaveLength(3);
    expect(session.history[0]?.kind).toBe("user");
    expect(session.history[1]?.kind).toBe("assistant");
    expect(session.history[2]?.kind).toBe("tool_results");
  });

  test("max turns limit stops processing", async () => {
    const { session } = createTestSession(
      [
        makeTextResponse("first"),
        makeTextResponse("second"),
      ],
      { config: { maxTurns: 2 } },
    );

    // After first submit: user(1) + assistant(2) = 2 turns total
    await session.submit("first input");
    expect(session.history).toHaveLength(2);

    // Second submit: user(3) = 3 turns, but maxTurns=2, so it should hit the limit
    await session.submit("second input");

    // user turn added, then countTurns = 3 >= 2 → TURN_LIMIT → break
    expect(session.history).toHaveLength(3);
    expect(session.history[2]?.kind).toBe("user");
  });

  test("steering injection adds SteeringTurn to history", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/x.ts" },
          },
        ]),
        makeTextResponse("done"),
      ],
      { files },
    );

    // Queue steering before submit — it will be drained at the start
    session.steer("be concise");
    await session.submit("do something");

    const steeringTurns = session.history.filter((t) => t.kind === "steering");
    expect(steeringTurns.length).toBeGreaterThanOrEqual(1);
    if (steeringTurns[0]?.kind === "steering") {
      expect(steeringTurns[0].content).toBe("be concise");
    }
  });

  test("follow-up queue processes second input after first", async () => {
    const { session } = createTestSession([
      makeTextResponse("first response"),
      makeTextResponse("followup response"),
    ]);

    session.followUp("followup question");
    await session.submit("first question");

    // Both inputs should be processed
    const userTurns = session.history.filter((t) => t.kind === "user");
    expect(userTurns).toHaveLength(2);
    if (userTurns[0]?.kind === "user" && userTurns[1]?.kind === "user") {
      expect(userTurns[0].content).toBe("first question");
      expect(userTurns[1].content).toBe("followup question");
    }
    const assistantTurns = session.history.filter(
      (t) => t.kind === "assistant",
    );
    expect(assistantTurns).toHaveLength(2);
  });

  test("loop detection injects steering warning", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    // Return the same tool call 5 times (window size), then text
    const sameToolCall = makeToolCallResponse([
      {
        id: "tc1",
        name: "read_file",
        arguments: { file_path: "/test/x.ts" },
      },
    ]);
    const { session } = createTestSession(
      [
        sameToolCall,
        sameToolCall,
        sameToolCall,
        sameToolCall,
        sameToolCall,
        makeTextResponse("done"),
      ],
      {
        files,
        config: {
          enableLoopDetection: true,
          loopDetectionWindow: 3,
        },
      },
    );

    await session.submit("keep going");

    const steeringTurns = session.history.filter((t) => t.kind === "steering");
    expect(steeringTurns.length).toBeGreaterThanOrEqual(1);
    const loopWarning = steeringTurns.find(
      (t) => t.kind === "steering" && t.content.includes("Loop detected"),
    );
    expect(loopWarning).toBeDefined();
  });

  test("abort via close stops processing", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/x.ts" },
          },
        ]),
        makeTextResponse("should not reach"),
      ],
      { files },
    );

    // Close immediately — the abort signal will be checked in the loop
    await session.close();

    // Submit should bail early because abort is signaled
    await session.submit("do stuff");

    // The state after submit is IDLE (set at the end of processInput)
    // But the history should be short since it bailed after the user turn was added
    const assistantTurns = session.history.filter(
      (t) => t.kind === "assistant",
    );
    expect(assistantTurns).toHaveLength(0);
  });

  test("tool error returns isError=true result", async () => {
    // Call a tool that will fail (file not found)
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/nonexistent.ts" },
          },
        ]),
        makeTextResponse("I see the error"),
      ],
      { files: new Map() },
    );

    await session.submit("read missing file");

    const toolResults = session.history.find((t) => t.kind === "tool_results");
    expect(toolResults).toBeDefined();
    if (toolResults?.kind === "tool_results") {
      expect(toolResults.results[0]?.isError).toBe(true);
      expect(toolResults.results[0]?.content).toContain("Tool error");
    }
  });

  test("unknown tool returns error result", async () => {
    const { session } = createTestSession([
      makeToolCallResponse([
        {
          id: "tc1",
          name: "nonexistent_tool",
          arguments: {},
        },
      ]),
      makeTextResponse("ok"),
    ]);

    await session.submit("call unknown tool");

    const toolResults = session.history.find((t) => t.kind === "tool_results");
    expect(toolResults).toBeDefined();
    if (toolResults?.kind === "tool_results") {
      expect(toolResults.results[0]?.isError).toBe(true);
      expect(toolResults.results[0]?.content).toContain("Tool not found");
    }
  });

  test("parallel tool calls execute when profile supports them", async () => {
    const files = new Map([
      ["/test/a.ts", "a content"],
      ["/test/b.ts", "b content"],
    ]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/a.ts" },
          },
          {
            id: "tc2",
            name: "read_file",
            arguments: { file_path: "/test/b.ts" },
          },
        ]),
        makeTextResponse("read both"),
      ],
      { files },
    );

    await session.submit("read both files");

    const toolResults = session.history.find((t) => t.kind === "tool_results");
    expect(toolResults).toBeDefined();
    if (toolResults?.kind === "tool_results") {
      expect(toolResults.results).toHaveLength(2);
      expect(toolResults.results[0]?.isError).toBe(false);
      expect(toolResults.results[1]?.isError).toBe(false);
    }
  });

  test("events are emitted for key lifecycle moments", async () => {
    const { session } = createTestSession([makeTextResponse("hi")]);

    const eventsPromise = collectEvents(session, EventKind.SESSION_END);
    await session.submit("test");

    const events = await eventsPromise;
    const kinds = events.map((e) => e.kind);

    // SESSION_START is emitted during construction before events() is called,
    // so the consumer may miss it. Verify the other lifecycle events.
    expect(kinds).toContain(EventKind.USER_INPUT);
    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_END);
    expect(kinds).toContain(EventKind.SESSION_END);
  });

  test("events include tool call events", async () => {
    const files = new Map([["/test/x.ts", "content"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/x.ts" },
          },
        ]),
        makeTextResponse("done"),
      ],
      { files },
    );

    const eventsPromise = collectEvents(session, EventKind.SESSION_END);
    await session.submit("read file");

    const events = await eventsPromise;
    const kinds = events.map((e) => e.kind);

    expect(kinds).toContain(EventKind.TOOL_CALL_START);
    expect(kinds).toContain(EventKind.TOOL_CALL_END);
  });

  test("session id is a uuid", () => {
    const { session } = createTestSession([makeTextResponse("hi")]);
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("session starts in IDLE state", () => {
    const { session } = createTestSession([makeTextResponse("hi")]);
    expect(session.state).toBe(SessionState.IDLE);
  });

  test("LLM request includes correct provider and model", async () => {
    const { session, adapter } = createTestSession([
      makeTextResponse("response"),
    ]);

    await session.submit("test");

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.model).toBe("test-model");
    expect(adapter.calls[0]?.provider).toBe("anthropic");
  });

  test("maxTurns=0 means unlimited (runs to natural completion)", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          { id: "tc1", name: "read_file", arguments: { file_path: "/test/x.ts" } },
        ]),
        makeToolCallResponse([
          { id: "tc2", name: "read_file", arguments: { file_path: "/test/x.ts" } },
        ]),
        makeTextResponse("done"),
      ],
      { files, config: { maxTurns: 0 } },
    );

    await session.submit("keep going");

    // All 3 LLM responses consumed: user, assistant+tc, tool_results, assistant+tc, tool_results, assistant
    expect(session.history).toHaveLength(6);
    const assistantTurns = session.history.filter((t) => t.kind === "assistant");
    expect(assistantTurns).toHaveLength(3);
  });

  test("abort via close transitions to CLOSED state", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          { id: "tc1", name: "read_file", arguments: { file_path: "/test/x.ts" } },
        ]),
        makeTextResponse("should not reach"),
      ],
      { files },
    );

    await session.close();
    await session.submit("do stuff");

    expect(session.state).toBe(SessionState.CLOSED);
  });

  test("LLM error transitions to CLOSED state", async () => {
    const adapter = new StubAdapter("anthropic", [
      { error: new Error("LLM exploded") },
    ]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    await session.submit("trigger error");

    expect(session.state).toBe(SessionState.CLOSED);
  });

  test("truncation config passes per-tool limits from session config", async () => {
    // Create a file with content longer than 10 chars
    const longContent = "x".repeat(100);
    const files = new Map([["/test/big.ts", longContent]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          {
            id: "tc1",
            name: "read_file",
            arguments: { file_path: "/test/big.ts" },
          },
        ]),
        makeTextResponse("done"),
      ],
      {
        files,
        config: {
          toolOutputLimits: { read_file: 20 },
        },
      },
    );

    await session.submit("read big file");

    const toolResults = session.history.find((t) => t.kind === "tool_results");
    expect(toolResults).toBeDefined();
    if (toolResults?.kind === "tool_results") {
      // The output should be truncated to ~20 chars (plus truncation markers)
      const content = toolResults.results[0]?.content;
      expect(typeof content).toBe("string");
      if (typeof content === "string") {
        expect(content).toContain("truncated");
      }
    }
  });

  test("abort signal is passed to LLM request", async () => {
    const { session, adapter } = createTestSession([
      makeTextResponse("response"),
    ]);

    await session.submit("test");

    expect(adapter.calls).toHaveLength(1);
    // The request should include an AbortSignal
    const request = adapter.calls[0];
    expect(request?.abortSignal).toBeDefined();
    expect(request?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test("context window warning emitted when usage exceeds 80%", async () => {
    // contextWindowSize for anthropic profile is 200_000 tokens
    // 80% threshold = 160_000 tokens
    // At 4 chars/token, need 640_001+ chars to exceed threshold
    const largeContent = "x".repeat(640_004);
    const { session } = createTestSession(
      [makeTextResponse(largeContent)],
    );

    const eventsPromise = collectEvents(session, EventKind.SESSION_END);
    await session.submit("generate big response");

    const events = await eventsPromise;
    const contextWarning = events.find(
      (e) => e.kind === EventKind.ERROR && e.data.type === "context_warning",
    );
    expect(contextWarning).toBeDefined();
    expect(contextWarning?.data.estimatedTokens).toBeGreaterThan(160_000);
  });
});
