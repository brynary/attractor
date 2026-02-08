import { describe, test, expect } from "bun:test";
import { validateToolArgs } from "../../src/tools/validate-args.js";

const readFileSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    file_path: { type: "string" },
    offset: { type: "integer" },
    limit: { type: "integer" },
  },
  required: ["file_path"],
};

describe("validateToolArgs", () => {
  test("returns null for valid args with all required fields", () => {
    const result = validateToolArgs(
      { file_path: "/test/foo.ts" },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("returns null for valid args with optional fields", () => {
    const result = validateToolArgs(
      { file_path: "/test/foo.ts", offset: 10, limit: 50 },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("returns error for missing required field", () => {
    const result = validateToolArgs({}, readFileSchema);
    expect(result).toBe('missing required field "file_path"');
  });

  test("returns error for wrong type (string expected, got number)", () => {
    const result = validateToolArgs(
      { file_path: 123 },
      readFileSchema,
    );
    expect(result).toBe('expected "file_path" to be string, got number');
  });

  test("returns error for wrong type (integer expected, got string)", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: "ten" },
      readFileSchema,
    );
    expect(result).toBe('expected "offset" to be integer, got string');
  });

  test("returns error for float when integer expected", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: 3.5 },
      readFileSchema,
    );
    expect(result).toBe('expected "offset" to be integer, got float');
  });

  test("allows extra properties not in schema", () => {
    const result = validateToolArgs(
      { file_path: "/test", extra_prop: "hello" },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("returns null for non-object schema (skip validation)", () => {
    const result = validateToolArgs(
      { anything: "goes" },
      { type: "string" },
    );
    expect(result).toBeNull();
  });

  test("returns null for schema without properties (skip validation)", () => {
    const result = validateToolArgs(
      { anything: "goes" },
      { type: "object" },
    );
    expect(result).toBeNull();
  });

  test("validates boolean type correctly", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        flag: { type: "boolean" },
      },
      required: ["flag"],
    };
    expect(validateToolArgs({ flag: true }, schema)).toBeNull();
    expect(validateToolArgs({ flag: "true" }, schema)).toBe(
      'expected "flag" to be boolean, got string',
    );
  });

  test("validates number type correctly", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        value: { type: "number" },
      },
      required: ["value"],
    };
    expect(validateToolArgs({ value: 3.14 }, schema)).toBeNull();
    expect(validateToolArgs({ value: 42 }, schema)).toBeNull();
    expect(validateToolArgs({ value: "42" }, schema)).toBe(
      'expected "value" to be number, got string',
    );
  });

  test("allows undefined values for optional fields", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: undefined },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("rejects null for typed optional fields", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: null },
      readFileSchema,
    );
    expect(result).toBe('expected "offset" to be integer, got null');
  });

  test("accepts value in enum list", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
      },
      required: ["output_mode"],
    };
    expect(validateToolArgs({ output_mode: "content" }, schema)).toBeNull();
    expect(validateToolArgs({ output_mode: "files_with_matches" }, schema)).toBeNull();
    expect(validateToolArgs({ output_mode: "count" }, schema)).toBeNull();
  });

  test("rejects value not in enum list", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
      },
      required: ["output_mode"],
    };
    expect(validateToolArgs({ output_mode: "invalid" }, schema)).toBe(
      '"output_mode" must be one of [content, files_with_matches, count], got "invalid"',
    );
  });

  test("accepts valid string array", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
    };
    expect(validateToolArgs({ paths: ["/a.ts", "/b.ts"] }, schema)).toBeNull();
  });

  test("accepts empty array", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
    };
    expect(validateToolArgs({ paths: [] }, schema)).toBeNull();
  });

  test("rejects non-array when array expected", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
    };
    expect(validateToolArgs({ paths: "not-an-array" }, schema)).toBe(
      'expected "paths" to be array, got string',
    );
  });

  test("rejects array with wrong element types", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
    };
    expect(validateToolArgs({ paths: ["/a.ts", 42] }, schema)).toBe(
      'expected "paths[1]" to be string, got number',
    );
  });

  test("accepts array without items schema (no element validation)", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        tags: { type: "array" },
      },
      required: ["tags"],
    };
    expect(validateToolArgs({ tags: [1, "two", true] }, schema)).toBeNull();
  });
});
