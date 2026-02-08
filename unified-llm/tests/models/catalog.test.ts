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

  test("OpenAI models have correct context window", () => {
    const model = getModelInfo("gpt-5.2");
    expect(model?.contextWindow).toBe(1_047_576);
  });

  test("finds Gemini models by id", () => {
    const pro = getModelInfo("gemini-3-pro-preview");
    expect(pro).toBeDefined();
    expect(pro?.provider).toBe("gemini");
    expect(pro?.displayName).toBe("Gemini 3 Pro Preview");

    const flash = getModelInfo("gemini-3-flash-preview");
    expect(flash).toBeDefined();
    expect(flash?.provider).toBe("gemini");
    expect(flash?.displayName).toBe("Gemini 3 Flash Preview");
  });

  test("finds Gemini models by alias", () => {
    expect(getModelInfo("gemini-pro")?.id).toBe("gemini-3-pro-preview");
    expect(getModelInfo("gemini-3-pro")?.id).toBe("gemini-3-pro-preview");
    expect(getModelInfo("gemini-flash")?.id).toBe("gemini-3-flash-preview");
    expect(getModelInfo("gemini-3-flash")?.id).toBe("gemini-3-flash-preview");
  });

  test("Gemini models have correct context window and max output", () => {
    const model = getModelInfo("gemini-3-pro-preview");
    expect(model?.contextWindow).toBe(1_048_576);
    expect(model?.maxOutput).toBe(65_536);
  });

  test("Gemini models support tools, vision, and reasoning", () => {
    const model = getModelInfo("gemini-3-pro-preview");
    expect(model?.supportsTools).toBe(true);
    expect(model?.supportsVision).toBe(true);
    expect(model?.supportsReasoning).toBe(true);
  });
});

describe("listModels", () => {
  test("lists all models when no provider specified", () => {
    const models = listModels();
    expect(models.length).toBeGreaterThanOrEqual(8);
  });

  test("filters by provider", () => {
    const anthropicModels = listModels("anthropic");
    expect(anthropicModels).toHaveLength(3);
    expect(anthropicModels.every((m) => m.provider === "anthropic")).toBe(true);

    const openaiModels = listModels("openai");
    expect(openaiModels).toHaveLength(3);
    expect(openaiModels.every((m) => m.provider === "openai")).toBe(true);

    const geminiModels = listModels("gemini");
    expect(geminiModels).toHaveLength(2);
    expect(geminiModels.every((m) => m.provider === "gemini")).toBe(true);
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

  test("filters by reasoning capability", () => {
    const model = getLatestModel("anthropic", "reasoning");
    expect(model).toBeDefined();
    expect(model?.supportsReasoning).toBe(true);
  });

  test("filters by vision capability", () => {
    const model = getLatestModel("openai", "vision");
    expect(model).toBeDefined();
    expect(model?.supportsVision).toBe(true);
  });

  test("filters by tools capability", () => {
    const model = getLatestModel("anthropic", "tools");
    expect(model).toBeDefined();
    expect(model?.supportsTools).toBe(true);
  });
});
