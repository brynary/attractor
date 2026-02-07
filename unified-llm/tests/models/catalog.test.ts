import { describe, test, expect } from "bun:test";
import {
  getModelInfo,
  listModels,
  getLatestModel,
} from "../../src/models/catalog.js";

describe("getModelInfo", () => {
  test("finds model by id", () => {
    const model = getModelInfo("claude-opus-4-6");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("anthropic");
    expect(model?.displayName).toBe("Claude Opus 4.6");
  });

  test("finds model by alias", () => {
    const model = getModelInfo("opus");
    expect(model).toBeDefined();
    expect(model?.id).toBe("claude-opus-4-6");
  });

  test("returns undefined for unknown model", () => {
    const model = getModelInfo("unknown-model");
    expect(model).toBeUndefined();
  });

  test("finds OpenAI models", () => {
    const model = getModelInfo("gpt-5.2");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openai");
  });
});

describe("listModels", () => {
  test("lists all models when no provider specified", () => {
    const models = listModels();
    expect(models.length).toBeGreaterThanOrEqual(5);
  });

  test("filters by provider", () => {
    const anthropicModels = listModels("anthropic");
    expect(anthropicModels).toHaveLength(2);
    expect(anthropicModels.every((m) => m.provider === "anthropic")).toBe(true);

    const openaiModels = listModels("openai");
    expect(openaiModels).toHaveLength(3);
    expect(openaiModels.every((m) => m.provider === "openai")).toBe(true);
  });

  test("returns empty array for unknown provider", () => {
    const models = listModels("unknown-provider");
    expect(models).toHaveLength(0);
  });
});

describe("getLatestModel", () => {
  test("returns latest Anthropic model", () => {
    const model = getLatestModel("anthropic");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("anthropic");
  });

  test("returns latest OpenAI model", () => {
    const model = getLatestModel("openai");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openai");
  });

  test("returns undefined for unknown provider", () => {
    const model = getLatestModel("unknown");
    expect(model).toBeUndefined();
  });
});
