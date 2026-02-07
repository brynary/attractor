import { describe, expect, test } from "bun:test";
import { StubBackend } from "../../src/backends/stub-backend.js";
import { Context } from "../../src/types/context.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import type { Node } from "../../src/types/graph.js";

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

describe("StubBackend", () => {
  test("returns configured response for node ID", async () => {
    const backend = new StubBackend({
      responses: new Map([["plan", "Here is the plan"]]),
    });

    const result = await backend.run(makeNode("plan"), "prompt", new Context());
    expect(result).toBe("Here is the plan");
  });

  test("returns default response when no match", async () => {
    const backend = new StubBackend({
      responses: new Map([["plan", "plan response"]]),
      defaultResponse: "default fallback",
    });

    const result = await backend.run(
      makeNode("unknown"),
      "prompt",
      new Context(),
    );
    expect(result).toBe("default fallback");
  });

  test("uses default 'stub response' when nothing configured", async () => {
    const backend = new StubBackend();

    const result = await backend.run(makeNode("any"), "prompt", new Context());
    expect(result).toBe("stub response");
  });

  test("uses response function when provided", async () => {
    const backend = new StubBackend({
      responseFn: (node, prompt) => `${node.id}: ${prompt}`,
    });

    const result = await backend.run(
      makeNode("plan"),
      "do the thing",
      new Context(),
    );
    expect(result).toBe("plan: do the thing");
  });

  test("response function can return an Outcome", async () => {
    const backend = new StubBackend({
      responseFn: () =>
        createOutcome({ status: StageStatus.FAIL, failureReason: "nope" }),
    });

    const result = await backend.run(makeNode("n"), "prompt", new Context());
    expect(typeof result).toBe("object");
    if (typeof result === "object") {
      expect(result.status).toBe(StageStatus.FAIL);
    }
  });
});
