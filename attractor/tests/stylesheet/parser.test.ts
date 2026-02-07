import { describe, expect, test } from "bun:test";
import { parseStylesheet } from "../../src/stylesheet/parser.js";

describe("parseStylesheet", () => {
  test("parses universal selector", () => {
    const rules = parseStylesheet("* { llm_model: claude-sonnet-4-5; }");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toEqual({
      kind: "universal",
      value: "*",
      specificity: 0,
    });
    expect(rules[0]?.declarations).toEqual([
      { property: "llm_model", value: "claude-sonnet-4-5" },
    ]);
  });

  test("parses class selector", () => {
    const rules = parseStylesheet(".code { llm_model: claude-opus-4-6; }");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toEqual({
      kind: "class",
      value: "code",
      specificity: 1,
    });
    expect(rules[0]?.declarations).toEqual([
      { property: "llm_model", value: "claude-opus-4-6" },
    ]);
  });

  test("parses ID selector", () => {
    const rules = parseStylesheet(
      "#critical_review { llm_model: gpt-5.2; llm_provider: openai; }",
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toEqual({
      kind: "id",
      value: "critical_review",
      specificity: 2,
    });
    expect(rules[0]?.declarations).toEqual([
      { property: "llm_model", value: "gpt-5.2" },
      { property: "llm_provider", value: "openai" },
    ]);
  });

  test("parses multiple declarations", () => {
    const rules = parseStylesheet(
      "* { llm_model: claude-sonnet-4-5; llm_provider: anthropic; reasoning_effort: medium; }",
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations).toEqual([
      { property: "llm_model", value: "claude-sonnet-4-5" },
      { property: "llm_provider", value: "anthropic" },
      { property: "reasoning_effort", value: "medium" },
    ]);
  });

  test("parses multiple rules", () => {
    const rules = parseStylesheet(
      `* { llm_model: claude-sonnet-4-5; }
       .code { llm_model: claude-opus-4-6; }
       #review { reasoning_effort: high; }`,
    );
    expect(rules).toHaveLength(3);
    expect(rules[0]?.selector.kind).toBe("universal");
    expect(rules[1]?.selector.kind).toBe("class");
    expect(rules[2]?.selector.kind).toBe("id");
  });

  test("returns empty array for empty input", () => {
    expect(parseStylesheet("")).toEqual([]);
    expect(parseStylesheet("   ")).toEqual([]);
  });

  test("handles missing trailing semicolon", () => {
    const rules = parseStylesheet("* { llm_model: claude-sonnet-4-5 }");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations).toEqual([
      { property: "llm_model", value: "claude-sonnet-4-5" },
    ]);
  });

  test("returns empty array for invalid syntax", () => {
    expect(parseStylesheet("not a stylesheet")).toEqual([]);
  });
});
