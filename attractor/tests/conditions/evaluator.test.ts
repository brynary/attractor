import { describe, test, expect } from "bun:test";
import {
  evaluateCondition,
  evaluateClause,
  resolveKey,
} from "../../src/conditions/evaluator.js";
import { createOutcome, StageStatus } from "../../src/types/outcome.js";
import { Context } from "../../src/types/context.js";

function makeOutcome(
  status: (typeof StageStatus)[keyof typeof StageStatus] = StageStatus.SUCCESS,
  preferredLabel = "",
) {
  return createOutcome({ status, preferredLabel });
}

function makeContext(entries: Record<string, string> = {}): Context {
  const ctx = new Context();
  for (const [k, v] of Object.entries(entries)) {
    ctx.set(k, v);
  }
  return ctx;
}

describe("resolveKey", () => {
  test("outcome returns status", () => {
    expect(resolveKey("outcome", makeOutcome(StageStatus.FAIL), makeContext())).toBe("fail");
  });

  test("preferred_label returns preferredLabel", () => {
    expect(resolveKey("preferred_label", makeOutcome(StageStatus.SUCCESS, "Fix"), makeContext())).toBe("Fix");
  });

  test("context.* with full key match", () => {
    const ctx = makeContext({ "context.foo": "bar" });
    expect(resolveKey("context.foo", makeOutcome(), ctx)).toBe("bar");
  });

  test("context.* falls back to stripped key", () => {
    const ctx = makeContext({ foo: "baz" });
    expect(resolveKey("context.foo", makeOutcome(), ctx)).toBe("baz");
  });

  test("unqualified key does direct context lookup", () => {
    const ctx = makeContext({ tests_passed: "true" });
    expect(resolveKey("tests_passed", makeOutcome(), ctx)).toBe("true");
  });

  test("missing key returns empty string", () => {
    expect(resolveKey("nonexistent", makeOutcome(), makeContext())).toBe("");
  });
});

describe("evaluateClause", () => {
  test("equals operator matches", () => {
    expect(evaluateClause("outcome=success", makeOutcome(StageStatus.SUCCESS), makeContext())).toBe(true);
  });

  test("equals operator rejects mismatch", () => {
    expect(evaluateClause("outcome=fail", makeOutcome(StageStatus.SUCCESS), makeContext())).toBe(false);
  });

  test("not-equals operator matches", () => {
    expect(evaluateClause("outcome!=fail", makeOutcome(StageStatus.SUCCESS), makeContext())).toBe(true);
  });

  test("not-equals operator rejects match", () => {
    expect(evaluateClause("outcome!=success", makeOutcome(StageStatus.SUCCESS), makeContext())).toBe(false);
  });

  test("bare key truthy when value is non-empty", () => {
    const ctx = makeContext({ flag: "yes" });
    expect(evaluateClause("flag", makeOutcome(), ctx)).toBe(true);
  });

  test("bare key falsy when value is empty/missing", () => {
    expect(evaluateClause("missing_key", makeOutcome(), makeContext())).toBe(false);
  });

  test("empty clause returns true", () => {
    expect(evaluateClause("", makeOutcome(), makeContext())).toBe(true);
  });
});

describe("evaluateCondition", () => {
  test("empty condition returns true", () => {
    expect(evaluateCondition("", makeOutcome(), makeContext())).toBe(true);
  });

  test("whitespace-only condition returns true", () => {
    expect(evaluateCondition("   ", makeOutcome(), makeContext())).toBe(true);
  });

  test("single clause matching", () => {
    expect(evaluateCondition("outcome=success", makeOutcome(StageStatus.SUCCESS), makeContext())).toBe(true);
  });

  test("AND conjunction all true", () => {
    const ctx = makeContext({ tests_passed: "true" });
    expect(
      evaluateCondition("outcome=success && tests_passed=true", makeOutcome(StageStatus.SUCCESS), ctx),
    ).toBe(true);
  });

  test("AND conjunction one false", () => {
    const ctx = makeContext({ tests_passed: "false" });
    expect(
      evaluateCondition("outcome=success && tests_passed=true", makeOutcome(StageStatus.SUCCESS), ctx),
    ).toBe(false);
  });

  test("preferred_label routing", () => {
    expect(
      evaluateCondition("preferred_label=Fix", makeOutcome(StageStatus.SUCCESS, "Fix"), makeContext()),
    ).toBe(true);
  });

  test("context.* key in condition", () => {
    const ctx = makeContext({ loop_state: "active" });
    expect(
      evaluateCondition("context.loop_state!=exhausted", makeOutcome(), ctx),
    ).toBe(true);
  });

  test("missing context key compares as empty string", () => {
    expect(
      evaluateCondition("context.missing=", makeOutcome(), makeContext()),
    ).toBe(true);
  });
});
