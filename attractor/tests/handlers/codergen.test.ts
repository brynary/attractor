import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CodergenHandler } from "../../src/handlers/codergen.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";
import { stringAttr } from "../../src/types/graph.js";
import type { Node, Graph } from "../../src/types/graph.js";
import type { CodergenBackend } from "../../src/types/handler.js";

const TEST_DIR = join(import.meta.dir, ".tmp-codergen-test");

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map<string, ReturnType<typeof stringAttr>>();
  for (const [k, v] of Object.entries(attrs)) {
    attributes.set(k, stringAttr(v));
  }
  return { id, attributes };
}

function makeGraph(goal: string = ""): Graph {
  const attributes = new Map<string, ReturnType<typeof stringAttr>>();
  if (goal) {
    attributes.set("goal", stringAttr(goal));
  }
  return { name: "test", attributes, nodes: new Map(), edges: [] };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("CodergenHandler", () => {
  describe("without backend (simulation)", () => {
    it("returns SUCCESS", async () => {
      const handler = new CodergenHandler();
      const outcome = await handler.execute(
        makeNode("plan"),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      expect(outcome.status).toBe(StageStatus.SUCCESS);
    });

    it("writes prompt.md with node label as fallback", async () => {
      const handler = new CodergenHandler();
      await handler.execute(
        makeNode("plan", { label: "Plan the work" }),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      const content = readFileSync(join(TEST_DIR, "plan", "prompt.md"), "utf-8");
      expect(content).toBe("Plan the work");
    });

    it("writes simulated response.md", async () => {
      const handler = new CodergenHandler();
      await handler.execute(makeNode("plan"), new Context(), makeGraph(), TEST_DIR);
      const content = readFileSync(join(TEST_DIR, "plan", "response.md"), "utf-8");
      expect(content).toContain("[Simulated]");
      expect(content).toContain("plan");
    });

    it("writes status.json", async () => {
      const handler = new CodergenHandler();
      await handler.execute(makeNode("plan"), new Context(), makeGraph(), TEST_DIR);
      const content = readFileSync(join(TEST_DIR, "plan", "status.json"), "utf-8");
      const status = JSON.parse(content);
      expect(status.status).toBe(StageStatus.SUCCESS);
    });

    it("sets last_stage and last_response in context updates", async () => {
      const handler = new CodergenHandler();
      const outcome = await handler.execute(
        makeNode("plan"),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      expect(outcome.contextUpdates.last_stage).toBe("plan");
      expect(outcome.contextUpdates.last_response).toContain("[Simulated]");
    });

    it("uses node id when no label or prompt", async () => {
      const handler = new CodergenHandler();
      await handler.execute(makeNode("my_stage"), new Context(), makeGraph(), TEST_DIR);
      const content = readFileSync(join(TEST_DIR, "my_stage", "prompt.md"), "utf-8");
      expect(content).toBe("my_stage");
    });
  });

  describe("prompt expansion", () => {
    it("expands $goal variable", async () => {
      const handler = new CodergenHandler();
      await handler.execute(
        makeNode("plan", { prompt: "Implement: $goal" }),
        new Context(),
        makeGraph("build a calculator"),
        TEST_DIR,
      );
      const content = readFileSync(join(TEST_DIR, "plan", "prompt.md"), "utf-8");
      expect(content).toBe("Implement: build a calculator");
    });

    it("expands multiple $goal occurrences", async () => {
      const handler = new CodergenHandler();
      await handler.execute(
        makeNode("plan", { prompt: "$goal - do $goal" }),
        new Context(),
        makeGraph("test"),
        TEST_DIR,
      );
      const content = readFileSync(join(TEST_DIR, "plan", "prompt.md"), "utf-8");
      expect(content).toBe("test - do test");
    });
  });

  describe("with stub backend", () => {
    it("returns backend string response", async () => {
      const backend: CodergenBackend = {
        run: async () => "Generated code here",
      };
      const handler = new CodergenHandler(backend);
      const outcome = await handler.execute(
        makeNode("impl"),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      expect(outcome.status).toBe(StageStatus.SUCCESS);
      const content = readFileSync(join(TEST_DIR, "impl", "response.md"), "utf-8");
      expect(content).toBe("Generated code here");
    });

    it("returns backend Outcome directly", async () => {
      const customOutcome = createOutcome({
        status: StageStatus.FAIL,
        failureReason: "LLM refused",
      });
      const backend: CodergenBackend = {
        run: async () => customOutcome,
      };
      const handler = new CodergenHandler(backend);
      const outcome = await handler.execute(
        makeNode("impl"),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      expect(outcome.status).toBe(StageStatus.FAIL);
      expect(outcome.failureReason).toBe("LLM refused");
    });

    it("handles backend errors gracefully", async () => {
      const backend: CodergenBackend = {
        run: async () => {
          throw new Error("API timeout");
        },
      };
      const handler = new CodergenHandler(backend);
      const outcome = await handler.execute(
        makeNode("impl"),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      expect(outcome.status).toBe(StageStatus.FAIL);
      expect(outcome.failureReason).toContain("API timeout");
    });

    it("truncates last_response to 200 chars", async () => {
      const longResponse = "x".repeat(500);
      const backend: CodergenBackend = {
        run: async () => longResponse,
      };
      const handler = new CodergenHandler(backend);
      const outcome = await handler.execute(
        makeNode("impl"),
        new Context(),
        makeGraph(),
        TEST_DIR,
      );
      const lastResponse = outcome.contextUpdates.last_response ?? "";
      expect(lastResponse.length).toBe(200);
    });
  });
});
