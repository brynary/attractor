import { describe, test, expect } from "bun:test";
import { StubAdapter } from "unified-llm/tests/stubs/stub-adapter.js";
import { Client, Role, StreamEventType } from "unified-llm";
import type { Response as LLMResponse, ToolCallData, StreamEvent } from "unified-llm";
import { Session } from "../../src/session/session.js";
import { createAnthropicProfile } from "../../src/profiles/anthropic-profile.js";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import type { SessionEvent } from "../../src/types/index.js";
import { EventKind, SessionState, DEFAULT_SESSION_CONFIG } from "../../src/types/index.js";
import type { SubAgentHandle } from "../../src/tools/subagent-tools.js";

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

function createFakeSubAgentHandle(overrides: { close: () => Promise<void> }): SubAgentHandle {
  return {
    id: "test-agent",
    status: "running",
    session: {
      id: "test-session",
      state: SessionState.IDLE,
      history: [],
      config: DEFAULT_SESSION_CONFIG,
    },
    submit: async () => {},
    waitForCompletion: async () => ({ output: "", success: true, turnsUsed: 0 }),
    close: overrides.close,
  };
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
      (t) =>
        t.kind === "steering" &&
        t.content ===
          "Loop detected: the last 3 tool calls follow a repeating pattern. Try a different approach.",
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

    // Close immediately — the session transitions to CLOSED
    await session.close();

    // Submit should throw because session is CLOSED
    expect(() => session.submit("do stuff")).toThrow("Cannot submit to a closed session");
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

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("test");

    const events = await eventsPromise;
    const kinds = events.map((e) => e.kind);

    // SESSION_START is emitted during construction and buffered by EventEmitter
    // until the first consumer registers, so it is replayed here.
    expect(kinds).toContain(EventKind.SESSION_START);
    expect(kinds).toContain(EventKind.USER_INPUT);
    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_END);
    expect(kinds).toContain(EventKind.INPUT_COMPLETE);
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

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("read file");

    const events = await eventsPromise;
    const kinds = events.map((e) => e.kind);

    expect(kinds).toContain(EventKind.TOOL_CALL_START);
    expect(kinds).toContain(EventKind.TOOL_CALL_OUTPUT_DELTA);
    expect(kinds).toContain(EventKind.TOOL_CALL_END);

    const outputDelta = events.find(
      (e) => e.kind === EventKind.TOOL_CALL_OUTPUT_DELTA,
    );
    expect(outputDelta?.data["call_id"]).toBe("tc1");
    expect(typeof outputDelta?.data["delta"]).toBe("string");
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

    expect(session.state).toBe(SessionState.CLOSED);
    // Submit after close should throw
    expect(() => session.submit("do stuff")).toThrow("Cannot submit to a closed session");
  });

  test("transient LLM error transitions to IDLE (host can retry)", async () => {
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

    expect(session.state).toBe(SessionState.IDLE);
  });

  test("unrecoverable LLM error (auth) transitions to CLOSED", async () => {
    const adapter = new StubAdapter("anthropic", [
      { error: new Error("401 Unauthorized: invalid api key") },
    ]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    await session.submit("trigger auth error");

    expect(session.state).toBe(SessionState.CLOSED);
  });

  test("unrecoverable LLM error (context overflow) transitions to CLOSED", async () => {
    const adapter = new StubAdapter("anthropic", [
      { error: new Error("context_length_exceeded: maximum context length is 200000") },
    ]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    await session.submit("trigger context overflow");

    expect(session.state).toBe(SessionState.CLOSED);
  });

  test("context overflow emits WARNING event before session closes", async () => {
    const adapter = new StubAdapter("anthropic", [
      { error: new Error("context_length_exceeded: maximum context length is 200000") },
    ]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    const eventsPromise = collectEvents(session, EventKind.SESSION_END);
    await session.submit("trigger context overflow");

    const events = await eventsPromise;
    const warning = events.find(
      (e) => e.kind === EventKind.WARNING && e.data.type === "context_overflow",
    );
    expect(warning).toBeDefined();
    expect(String(warning?.data.message ?? "")).toContain("Context window overflow");
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

  test("validation error returned when required field missing", async () => {
    const { session } = createTestSession([
      makeToolCallResponse([
        {
          id: "tc1",
          name: "read_file",
          arguments: {}, // missing required file_path
        },
      ]),
      makeTextResponse("I see the validation error"),
    ]);

    await session.submit("read a file");

    const toolResults = session.history.find((t) => t.kind === "tool_results");
    expect(toolResults).toBeDefined();
    if (toolResults?.kind === "tool_results") {
      expect(toolResults.results[0]?.isError).toBe(true);
      expect(toolResults.results[0]?.content).toContain("Validation error for tool read_file");
      expect(toolResults.results[0]?.content).toContain('missing required field "file_path"');
    }
  });

  test("validation error returned when field has wrong type", async () => {
    const { session } = createTestSession([
      makeToolCallResponse([
        {
          id: "tc1",
          name: "read_file",
          arguments: { file_path: 123 }, // should be string
        },
      ]),
      makeTextResponse("I see the type error"),
    ]);

    await session.submit("read with bad args");

    const toolResults = session.history.find((t) => t.kind === "tool_results");
    expect(toolResults).toBeDefined();
    if (toolResults?.kind === "tool_results") {
      expect(toolResults.results[0]?.isError).toBe(true);
      expect(toolResults.results[0]?.content).toContain("Validation error for tool read_file");
      expect(toolResults.results[0]?.content).toContain('expected "file_path" to be string');
    }
  });

  test("context window warning emitted when usage exceeds 80%", async () => {
    // contextWindowSize for anthropic profile is 200_000 tokens
    // 80% threshold = 160_000 tokens
    // At 4 chars/token, need 640_001+ chars to exceed threshold
    const largeContent = "x".repeat(640_004);
    const { session } = createTestSession(
      [makeTextResponse(largeContent)],
    );

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("generate big response");

    const events = await eventsPromise;
    const contextWarning = events.find(
      (e) => e.kind === EventKind.WARNING && e.data.type === "context_warning",
    );
    expect(contextWarning).toBeDefined();
    expect(contextWarning?.data.estimatedTokens).toBeGreaterThan(160_000);
  });

  test("context window warning includes tool call names and arguments in estimation", async () => {
    // contextWindowSize for anthropic profile is 200_000 tokens
    // 80% threshold = 160_000 tokens = 640_000 chars at 4 chars/token
    // Use tool call arguments large enough to exceed the threshold
    const largeArgs = { data: "y".repeat(640_004) };
    const toolCallResp = makeToolCallResponse([
      { id: "tc-big", name: "read_file", arguments: largeArgs },
    ]);
    const files = new Map([["/test/foo.ts", "content"]]);
    const { session } = createTestSession(
      [toolCallResp, makeTextResponse("done")],
      { files },
    );

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("run it");

    const events = await eventsPromise;
    const contextWarning = events.find(
      (e) => e.kind === EventKind.WARNING && e.data.type === "context_warning",
    );
    expect(contextWarning).toBeDefined();
    expect(contextWarning?.data.estimatedTokens).toBeGreaterThan(160_000);
  });

  test("streaming emits ASSISTANT_TEXT_START, DELTA, and END events", async () => {
    const streamEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, id: "resp-stream", model: "test-model" },
      { type: StreamEventType.TEXT_START },
      { type: StreamEventType.TEXT_DELTA, delta: "Hello " },
      { type: StreamEventType.TEXT_DELTA, delta: "world" },
      { type: StreamEventType.TEXT_END },
      { type: StreamEventType.FINISH, finishReason: { reason: "stop" }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ];

    const adapter = new StubAdapter(
      "anthropic",
      [{ events: streamEvents }],
    );
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
      config: { enableStreaming: true },
    });

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("Hi");

    const events = await eventsPromise;
    const kinds = events.map((e) => e.kind);

    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_START);
    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_DELTA);
    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_END);

    const deltas = events.filter((e) => e.kind === EventKind.ASSISTANT_TEXT_DELTA);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]?.data["delta"]).toBe("Hello ");
    expect(deltas[1]?.data["delta"]).toBe("world");

    const endEvent = events.find((e) => e.kind === EventKind.ASSISTANT_TEXT_END);
    expect(endEvent?.data["text"]).toBe("Hello world");
  });

  test("close() is idempotent", async () => {
    const { session } = createTestSession([makeTextResponse("hi")]);

    await session.submit("test");
    expect(session.state).toBe(SessionState.IDLE);

    await session.close();
    expect(session.state).toBe(SessionState.CLOSED);

    // Second close should not throw
    await session.close();
    expect(session.state).toBe(SessionState.CLOSED);
  });

  test("unrecoverable LLM error path calls close() for subagent cleanup", async () => {
    const adapter = new StubAdapter("anthropic", [
      { error: new Error("401 Unauthorized") },
    ]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    // Add a fake subagent to verify close() cleans it up
    let subagentClosed = false;
    session.subagents.set("test-agent", createFakeSubAgentHandle({
      close: async () => { subagentClosed = true; },
    }));

    await session.submit("trigger error");

    expect(session.state).toBe(SessionState.CLOSED);
    expect(subagentClosed).toBe(true);
    expect(session.subagents.size).toBe(0);
  });

  test("abort path calls close() for subagent cleanup", async () => {
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

    // Add a fake subagent to verify close() cleans it up
    let subagentClosed = false;
    session.subagents.set("test-agent", createFakeSubAgentHandle({
      close: async () => { subagentClosed = true; },
    }));

    await session.close();

    expect(session.state).toBe(SessionState.CLOSED);
    expect(subagentClosed).toBe(true);
    expect(session.subagents.size).toBe(0);
  });

  test("question response transitions to AWAITING_INPUT state", async () => {
    const { session } = createTestSession([
      makeTextResponse("What file should I read?"),
    ]);

    await session.submit("Help me");

    expect(session.state).toBe(SessionState.AWAITING_INPUT);
  });

  test("statement response transitions to IDLE state", async () => {
    const { session } = createTestSession([
      makeTextResponse("Here is the answer."),
    ]);

    await session.submit("Help me");

    expect(session.state).toBe(SessionState.IDLE);
  });

  test("submit works from AWAITING_INPUT state", async () => {
    const { session } = createTestSession([
      makeTextResponse("Which file?"),
      makeTextResponse("Got it, done."),
    ]);

    await session.submit("Help me");
    expect(session.state).toBe(SessionState.AWAITING_INPUT);

    await session.submit("foo.ts");
    expect(session.state).toBe(SessionState.IDLE);
  });

  test("streaming disabled falls back to complete()", async () => {
    const { session } = createTestSession([makeTextResponse("no stream")], {
      config: { enableStreaming: false },
    });

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("Hi");

    const events = await eventsPromise;
    const kinds = events.map((e) => e.kind);

    // Non-streaming path emits START and END but NOT DELTA
    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_START);
    expect(kinds).not.toContain(EventKind.ASSISTANT_TEXT_DELTA);
    expect(kinds).toContain(EventKind.ASSISTANT_TEXT_END);
  });

  test("submit() throws when session is PROCESSING", async () => {
    const { session } = createTestSession([makeTextResponse("hi")]);

    // Manually set state to PROCESSING to simulate concurrent submit
    session.state = SessionState.PROCESSING;

    expect(() => session.submit("second")).toThrow("Cannot submit while session is processing");
  });

  test("SESSION_START event is delivered to late consumer via buffering", async () => {
    const { session } = createTestSession([makeTextResponse("hi")]);

    // events() is called after construction, so SESSION_START was already emitted
    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("test");

    const events = await eventsPromise;
    expect(events[0]?.kind).toBe(EventKind.SESSION_START);
  });

  test("ASSISTANT_TEXT_END includes reasoning field (non-streaming)", async () => {
    const response: LLMResponse = {
      id: "resp-1",
      model: "test-model",
      provider: "anthropic",
      message: {
        role: Role.ASSISTANT,
        content: [
          { kind: "thinking", thinking: { text: "I thought about this carefully", redacted: false } },
          { kind: "text", text: "answer" },
        ],
      },
      finishReason: { reason: "stop" },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: [],
    };
    const adapter = new StubAdapter("anthropic", [{ response }]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("think about this");

    const events = await eventsPromise;
    const endEvent = events.find((e) => e.kind === EventKind.ASSISTANT_TEXT_END);
    expect(endEvent?.data["reasoning"]).toBe("I thought about this carefully");
  });

  test("LOOP_DETECTION event data includes message field", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
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

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("keep going");

    const events = await eventsPromise;
    const loopEvent = events.find((e) => e.kind === EventKind.LOOP_DETECTION);
    expect(loopEvent).toBeDefined();
    expect(loopEvent?.data["message"]).toBe(
      "Loop detected: the last 3 tool calls follow a repeating pattern. Try a different approach.",
    );
  });

  test("context warning event includes message field", async () => {
    const largeContent = "x".repeat(640_004);
    const { session } = createTestSession(
      [makeTextResponse(largeContent)],
    );

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("generate big response");

    const events = await eventsPromise;
    const contextWarning = events.find(
      (e) => e.kind === EventKind.WARNING && e.data.type === "context_warning",
    );
    expect(contextWarning).toBeDefined();
    expect(typeof contextWarning?.data["message"]).toBe("string");
    expect(contextWarning?.data["message"]).toContain("Context usage at ~");
    expect(contextWarning?.data["message"]).toContain("% of context window");
  });

  test("close() awaits running tool executions before emitting SESSION_END", async () => {
    let resolveToolStarted: () => void = () => {};
    const toolStarted = new Promise<void>((resolve) => { resolveToolStarted = resolve; });
    let resolveToolFinished: () => void = () => {};
    const toolFinished = new Promise<void>((resolve) => { resolveToolFinished = resolve; });

    const adapter = new StubAdapter(
      "anthropic",
      [
        { response: makeToolCallResponse([
          { id: "tc1", name: "slow_tool", arguments: {} },
        ]) },
        { response: makeTextResponse("done") },
      ],
    );
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    profile.toolRegistry.register({
      definition: {
        name: "slow_tool",
        description: "A slow tool",
        parameters: { type: "object", properties: {} },
      },
      executor: async () => {
        resolveToolStarted();
        await toolFinished;
        return "done";
      },
    });

    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    // Start processing — will block on the slow tool
    const submitPromise = session.submit("run slow tool");

    // Wait for the tool to actually start executing
    await toolStarted;

    // Track whether close() has completed
    let closeDone = false;
    const closePromise = session.close().then(() => { closeDone = true; });

    // Give close() a tick to run — it should be waiting for the tool
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(closeDone).toBe(false);

    // Now resolve the tool — close() should complete
    resolveToolFinished();
    await closePromise;

    expect(closeDone).toBe(true);
    expect(session.state).toBe(SessionState.CLOSED);

    // Let submit settle (it exits due to abort)
    await submitPromise.catch(() => {});
  });

  test("close() does not hang when no tools are running", async () => {
    const { session } = createTestSession([makeTextResponse("hi")]);

    await session.submit("test");

    // close() should complete promptly with no running tools
    await session.close();
    expect(session.state).toBe(SessionState.CLOSED);
  });

  test("transient LLM error emits ERROR event but allows retry", async () => {
    const adapter = new StubAdapter("anthropic", [
      { error: new Error("rate limit exceeded") },
      { response: makeTextResponse("recovered") },
    ]);
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();
    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    await session.submit("first try");
    expect(session.state).toBe(SessionState.IDLE);

    // Host can retry after transient error
    await session.submit("retry");
    expect(session.state).toBe(SessionState.IDLE);
    expect(session.history.filter((t) => t.kind === "assistant")).toHaveLength(1);
  });

  test("shell tool uses config.defaultCommandTimeoutMs when no timeout_ms provided", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          { id: "tc1", name: "shell", arguments: { command: "echo hello" } },
        ]),
        makeTextResponse("done"),
      ],
      {
        config: {
          defaultCommandTimeoutMs: 30_000,
          toolCallInterceptor: {
            pre: async (_name, args) => {
              capturedArgs = args;
              return true;
            },
          },
        },
      },
    );

    await session.submit("run command");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs?.timeout_ms).toBe(30_000);
  });

  test("shell tool clamps timeout_ms to config.maxCommandTimeoutMs", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          { id: "tc1", name: "shell", arguments: { command: "echo hello", timeout_ms: 999_999 } },
        ]),
        makeTextResponse("done"),
      ],
      {
        config: {
          maxCommandTimeoutMs: 60_000,
          toolCallInterceptor: {
            pre: async (_name, args) => {
              capturedArgs = args;
              return true;
            },
          },
        },
      },
    );

    await session.submit("run command");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs?.timeout_ms).toBe(60_000);
  });

  test("shell tool uses LLM-provided timeout_ms when within max limit", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          { id: "tc1", name: "shell", arguments: { command: "echo hello", timeout_ms: 45_000 } },
        ]),
        makeTextResponse("done"),
      ],
      {
        config: {
          defaultCommandTimeoutMs: 10_000,
          maxCommandTimeoutMs: 600_000,
          toolCallInterceptor: {
            pre: async (_name, args) => {
              capturedArgs = args;
              return true;
            },
          },
        },
      },
    );

    await session.submit("run command");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs?.timeout_ms).toBe(45_000);
  });

  test("subagent tools are registered by Session even without sessionFactory", async () => {
    const { session } = createTestSession([makeTextResponse("child finished")]);

    const names = session.providerProfile.toolRegistry.names();
    expect(names).toContain("spawn_agent");
    expect(names).toContain("send_input");
    expect(names).toContain("wait");
    expect(names).toContain("close_agent");
  });

  test("maxSubagentDepth=0 disables spawn_agent", async () => {
    const { session, env } = createTestSession(
      [makeTextResponse("unused")],
      { config: { maxSubagentDepth: 0 } },
    );

    const spawn = session.providerProfile.toolRegistry.get("spawn_agent");
    expect(spawn).toBeDefined();
    const result = await spawn!.executor({ task: "do work" }, env);
    expect(result).toContain("disabled at depth 0");
  });

  test("non-streaming emits ASSISTANT_TEXT_END for tool-only turns", async () => {
    const files = new Map([["/test/x.ts", "x"]]);
    const { session } = createTestSession(
      [
        makeToolCallResponse([
          { id: "tc1", name: "read_file", arguments: { file_path: "/test/x.ts" } },
        ]),
        makeTextResponse("done"),
      ],
      { files },
    );

    const eventsPromise = collectEvents(session, EventKind.INPUT_COMPLETE);
    await session.submit("read x");
    const events = await eventsPromise;

    const endEvents = events.filter((e) => e.kind === EventKind.ASSISTANT_TEXT_END);
    expect(endEvents.length).toBeGreaterThanOrEqual(2);
    expect(endEvents[0]?.data["text"]).toBe("");
    expect(endEvents[0]?.data["toolCallCount"]).toBe(1);
  });

  test("custom awaitingInputDetector overrides default heuristic", async () => {
    const { session } = createTestSession(
      [makeTextResponse("What file should I read?")],
      {
        config: {
          awaitingInputDetector: () => false,
        },
      },
    );

    await session.submit("Help me");
    expect(session.state).toBe(SessionState.IDLE);
  });

  test("sessions do not share subagent handles when reusing the same profile", async () => {
    const adapter = new StubAdapter("anthropic", []);
    const client = new Client({ providers: { anthropic: adapter } });
    const sharedProfile = createAnthropicProfile("test-model");
    const env = new StubExecutionEnvironment();

    const sessionA = new Session({
      providerProfile: sharedProfile,
      executionEnv: env,
      llmClient: client,
    });
    const sessionB = new Session({
      providerProfile: sharedProfile,
      executionEnv: env,
      llmClient: client,
    });

    sessionA.subagents.set(
      "agent-a",
      createFakeSubAgentHandle({ close: async () => {} }),
    );

    expect(sessionA.subagents.size).toBe(1);
    expect(sessionB.subagents.size).toBe(0);

    await sessionA.close();
    await sessionB.close();
  });

  test("spawn_agent working_dir scopes child shell execution cwd", async () => {
    const responses = [
      makeToolCallResponse([
        {
          id: "parent-spawn",
          name: "spawn_agent",
          arguments: { task: "run a shell command", working_dir: "sub" },
        },
      ]),
      makeToolCallResponse([
        {
          id: "child-shell",
          name: "shell",
          arguments: { command: "echo child" },
        },
      ]),
      makeTextResponse("child done"),
    ];
    const adapter = new StubAdapter(
      "anthropic",
      responses.map((response) => ({ response })),
    );
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("test-model");

    class RecordingEnv extends StubExecutionEnvironment {
      readonly execCalls: Array<{ command: string; workingDir?: string }> = [];

      async execCommand(
        command: string,
        timeoutMs: number,
        workingDir?: string,
        envVars?: Record<string, string>,
        abortSignal?: AbortSignal,
      ) {
        this.execCalls.push({ command, workingDir });
        return super.execCommand(command, timeoutMs, workingDir, envVars, abortSignal);
      }
    }

    const env = new RecordingEnv({
      commandResults: new Map([
        [
          "echo child",
          {
            stdout: "child\n",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            durationMs: 1,
          },
        ],
      ]),
    });

    const session = new Session({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
      config: { maxToolRoundsPerInput: 1 },
    });

    await session.submit("spawn a child");

    let sawScopedCall = false;
    for (let i = 0; i < 30; i++) {
      sawScopedCall = env.execCalls.some(
        (call) => call.command === "echo child" && call.workingDir === "/test/sub",
      );
      if (sawScopedCall) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(sawScopedCall).toBe(true);
    await session.close();
  });
});
