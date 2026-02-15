import { StubAdapter } from "unified-llm/tests/stubs/stub-adapter.js";
import { Client, Role } from "unified-llm";
import type { Response as LLMResponse } from "unified-llm";
import { Session } from "./coding-agent/src/session/session.js";
import { createAnthropicProfile } from "./coding-agent/src/profiles/anthropic-profile.js";
import { StubExecutionEnvironment } from "./coding-agent/tests/stubs/stub-env.js";

function makeToolCallResponse(toolCalls: Array<{id: string; name: string; arguments: Record<string, unknown>}>): LLMResponse {
  return {
    id: "resp-tc", model: "test-model", provider: "anthropic",
    message: { role: Role.ASSISTANT, content: toolCalls.map((tc) => ({ kind: "tool_call" as const, toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments } })) },
    finishReason: { reason: "tool_calls" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

function makeTextResponse(text: string): LLMResponse {
  return {
    id: "resp-1", model: "test-model", provider: "anthropic",
    message: { role: Role.ASSISTANT, content: [{ kind: "text", text }] },
    finishReason: { reason: "stop" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

async function main() {
  const toolFinishedDeferred = Promise.withResolvers<void>();
  const toolStartedDeferred = Promise.withResolvers<void>();

  const adapter = new StubAdapter("anthropic", [
    makeToolCallResponse([{ id: "tc1", name: "slow_tool", arguments: {} }]),
    makeTextResponse("done"),
  ]);
  const client = new Client({ providers: { anthropic: adapter } });
  const profile = createAnthropicProfile("test-model");
  profile.toolRegistry.register({
    definition: { name: "slow_tool", description: "A slow tool", parameters: { type: "object", properties: {} } },
    executor: async () => {
      console.log("[executor] tool started, signaling");
      toolStartedDeferred.resolve();
      console.log("[executor] awaiting toolFinished");
      await toolFinishedDeferred.promise;
      console.log("[executor] toolFinished resolved, returning");
      return "done";
    },
  });

  const env = new StubExecutionEnvironment();
  const session = new Session({ providerProfile: profile, executionEnv: env, llmClient: client });

  console.log("[test] starting submit");
  const submitPromise = session.submit("run slow tool");
  submitPromise.then(() => console.log("[test] submit resolved")).catch((e) => console.log("[test] submit rejected:", e));

  console.log("[test] awaiting toolStarted");
  await toolStartedDeferred.promise;
  console.log("[test] tool has started");

  let closeDone = false;
  console.log("[test] calling close()");
  const closePromise = session.close().then(() => { closeDone = true; console.log("[test] close completed"); });

  await new Promise<void>((r) => setTimeout(r, 50));
  console.log("[test] closeDone after 50ms:", closeDone);

  console.log("[test] resolving toolFinished");
  toolFinishedDeferred.resolve();

  await new Promise<void>((r) => setTimeout(r, 200));
  console.log("[test] closeDone after 200ms:", closeDone);

  if (!closeDone) {
    console.log("[test] close() still pending, force exiting");
    process.exit(1);
  }

  console.log("[test] success");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
