/**
 * End-to-end tests for the attractor pipeline engine using real LLMs.
 *
 * These tests exercise the same scenarios as attractor-e2e.test.ts but
 * with actual LLM calls via the SessionBackend (coding-agent + unified-llm).
 *
 * Requires ANTHROPIC_API_KEY in .env to run.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parse,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  WaitForHumanHandler,
  SessionBackend,
  AutoApproveInterviewer,
  QueueInterviewer,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
  createAnswer,
} from "../attractor/src/index.js";
import type { PipelineEvent } from "../attractor/src/index.js";
import { Client, AnthropicAdapter } from "../unified-llm/src/index.js";
import { createAnthropicProfile } from "../coding-agent/src/profiles/anthropic-profile.js";
import { LocalExecutionEnvironment } from "../coding-agent/src/env/local-env.js";

// Load .env from repo root
const envFile = Bun.file(join(import.meta.dir, "../.env"));
if (await envFile.exists()) {
  const envText = await envFile.text();
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (value) {
      process.env[key] = value;
    }
  }
}

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const shouldRun = Boolean(anthropicKey);

describe("attractor with real LLM (Anthropic)", () => {
  let tempDir: string;
  let logsDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "attractor-real-llm-"));
    logsDir = join(tempDir, "logs");
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function makeBackend(): { backend: SessionBackend; client: Client } {
    const adapter = new AnthropicAdapter({ apiKey: anthropicKey ?? "" });
    const client = new Client({ providers: { anthropic: adapter } });
    const profile = createAnthropicProfile("claude-sonnet-4-5-20250929");
    const env = new LocalExecutionEnvironment({ workingDir: tempDir });

    const backend = new SessionBackend({
      providerProfile: profile,
      executionEnv: env,
      llmClient: client,
    });

    return { backend, client };
  }

  test.skipIf(!shouldRun)(
    "linear pipeline: plan then implement",
    async () => {
      const { backend, client } = makeBackend();

      const dot = `
        digraph LinearReal {
          graph [goal="Create a hello world function"]

          start [shape=Mdiamond]
          exit  [shape=Msquare]
          plan  [label="Plan", prompt="Briefly describe (in 1-2 sentences) how you would write a TypeScript function called helloWorld that returns the string 'Hello, World!'. Do not write any code, just describe the plan."]
          write [label="Write", prompt="Write a TypeScript file called hello.ts in ${tempDir} containing a function called helloWorld that returns the string 'Hello, World!'. Export the function."]

          start -> plan -> write -> exit
        }
      `;
      const graph = parse(dot);

      const emitter = new PipelineEventEmitter();
      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));

      const collectedEvents: PipelineEvent[] = [];
      const eventPromise = (async () => {
        for await (const event of emitter.events()) {
          collectedEvents.push(event);
        }
      })();

      const runner = new PipelineRunner({
        handlerRegistry: registry,
        eventEmitter: emitter,
        logsRoot: join(logsDir, "linear"),
      });

      const result = await runner.run(graph);
      emitter.close();
      await eventPromise;

      console.log("  [Linear] Status:", result.outcome.status);
      console.log("  [Linear] Completed:", result.completedNodes);

      expect(result.outcome.status).toBe(StageStatus.SUCCESS);
      expect(result.completedNodes).toContain("plan");
      expect(result.completedNodes).toContain("write");

      // Verify the file was actually created by the LLM
      const helloFile = Bun.file(join(tempDir, "hello.ts"));
      const exists = await helloFile.exists();
      console.log("  [Linear] hello.ts exists:", exists);
      if (exists) {
        const content = await helloFile.text();
        console.log("  [Linear] hello.ts content:", content.slice(0, 200));
        expect(content).toContain("helloWorld");
      }

      // Verify events were emitted
      const kinds = collectedEvents.map((e) => e.kind);
      expect(kinds).toContain(PipelineEventKind.PIPELINE_STARTED);
      expect(kinds).toContain(PipelineEventKind.PIPELINE_COMPLETED);

      await client.close();
    },
    120_000,
  );

  test.skipIf(!shouldRun)(
    "two-stage pipeline: generate then review",
    async () => {
      const { backend, client } = makeBackend();

      const dot = `
        digraph ReviewReal {
          graph [goal="Generate and review a utility function"]

          start  [shape=Mdiamond]
          exit   [shape=Msquare]
          generate [label="Generate", prompt="Write a short TypeScript function called 'add' that takes two numbers and returns their sum. Just respond with the code, nothing else."]
          review   [label="Review", prompt="Review the code generated in the previous step. Is it correct? Respond with just 'LGTM' if it looks good, or describe any issues."]

          start -> generate -> review -> exit
        }
      `;
      const graph = parse(dot);

      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));

      const runner = new PipelineRunner({
        handlerRegistry: registry,
        logsRoot: join(logsDir, "review"),
      });

      const result = await runner.run(graph);

      console.log("  [Review] Status:", result.outcome.status);
      console.log("  [Review] Completed:", result.completedNodes);
      console.log("  [Review] Last response:", result.context.get("last_response").slice(0, 200));

      expect(result.outcome.status).toBe(StageStatus.SUCCESS);
      expect(result.completedNodes).toContain("generate");
      expect(result.completedNodes).toContain("review");

      // Context should flow — last_stage should be "review"
      expect(result.context.get("last_stage")).toBe("review");

      await client.close();
    },
    120_000,
  );

  test.skipIf(!shouldRun)(
    "human-in-the-loop gate with auto-approve",
    async () => {
      const { backend, client } = makeBackend();

      const dot = `
        digraph HumanGateReal {
          graph [goal="Write code and get approval"]

          start  [shape=Mdiamond]
          exit   [shape=Msquare]
          write  [label="Write Code", prompt="Write a one-line TypeScript function called 'double' that takes a number and returns it multiplied by 2. Just respond with the code."]
          gate   [shape=hexagon, label="Approve the code?"]
          ship   [label="Ship", prompt="The code was approved. Confirm it is ready to ship in one sentence."]
          revise [label="Revise", prompt="Revise the code"]

          start -> write -> gate
          gate -> ship   [label="[A] Approve"]
          gate -> revise [label="[R] Revise"]
          ship -> exit
        }
      `;
      const graph = parse(dot);

      const interviewer = new AutoApproveInterviewer();
      const registry = createHandlerRegistry();
      registry.register("start", new StartHandler());
      registry.register("exit", new ExitHandler());
      registry.register("codergen", new CodergenHandler(backend));
      registry.register("wait.human", new WaitForHumanHandler(interviewer));

      const runner = new PipelineRunner({
        handlerRegistry: registry,
        interviewer,
        logsRoot: join(logsDir, "human-gate"),
      });

      const result = await runner.run(graph);

      console.log("  [HumanGate] Status:", result.outcome.status);
      console.log("  [HumanGate] Completed:", result.completedNodes);

      expect(result.outcome.status).toBe(StageStatus.SUCCESS);
      expect(result.completedNodes).toContain("write");
      expect(result.completedNodes).toContain("gate");
      expect(result.completedNodes).toContain("ship");
      expect(result.completedNodes).not.toContain("revise");

      await client.close();
    },
    120_000,
  );
});
