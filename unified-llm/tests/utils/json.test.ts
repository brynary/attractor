import { describe, test, expect } from "bun:test";
import { safeJsonParse, partialJsonParse } from "../../src/utils/json.js";

describe("safeJsonParse", () => {
  test("parses valid JSON", () => {
    const result = safeJsonParse('{"key": "value"}');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ key: "value" });
    }
  });

  test("returns error for invalid JSON", () => {
    const result = safeJsonParse("not json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  test("parses arrays", () => {
    const result = safeJsonParse("[1, 2, 3]");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  test("parses primitives", () => {
    const result = safeJsonParse("42");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe(42);
    }
  });
});

describe("partialJsonParse", () => {
  test("parses complete JSON", () => {
    expect(partialJsonParse('{"key": "value"}')).toEqual({ key: "value" });
  });

  test("handles incomplete object", () => {
    expect(partialJsonParse('{"key": "value"')).toEqual({ key: "value" });
  });

  test("handles incomplete array", () => {
    expect(partialJsonParse("[1, 2, 3")).toEqual([1, 2, 3]);
  });

  test("handles trailing comma", () => {
    expect(partialJsonParse('{"a": 1,')).toEqual({ a: 1 });
  });

  test("handles nested incomplete objects", () => {
    expect(partialJsonParse('{"a": {"b": 1')).toEqual({ a: { b: 1 } });
  });

  test("returns undefined for empty string", () => {
    expect(partialJsonParse("")).toBeUndefined();
  });

  test("returns undefined for unparseable content", () => {
    expect(partialJsonParse("not json at all {{{")).toBeUndefined();
  });
});
