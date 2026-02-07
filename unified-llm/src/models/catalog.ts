import type { ModelInfo } from "../types/model-info.js";

const models: ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus 4.6",
    contextWindow: 200_000,
    maxOutput: 32_000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
    aliases: ["claude-opus", "opus"],
  },
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    contextWindow: 200_000,
    maxOutput: 16_000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    aliases: ["claude-sonnet", "sonnet"],
  },
  {
    id: "gpt-5.2",
    provider: "openai",
    displayName: "GPT-5.2",
    contextWindow: 128_000,
    maxOutput: 16_384,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
    aliases: ["gpt-5.2"],
  },
  {
    id: "gpt-5.2-mini",
    provider: "openai",
    displayName: "GPT-5.2 Mini",
    contextWindow: 128_000,
    maxOutput: 16_384,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 6,
    aliases: ["gpt-5.2-mini", "gpt-mini"],
  },
  {
    id: "gpt-5.2-codex",
    provider: "openai",
    displayName: "GPT-5.2 Codex",
    contextWindow: 128_000,
    maxOutput: 16_384,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
    aliases: ["gpt-codex", "codex"],
  },
];

export function getModelInfo(
  idOrAlias: string,
): ModelInfo | undefined {
  return models.find(
    (m) => m.id === idOrAlias || m.aliases.includes(idOrAlias),
  );
}

export function listModels(provider?: string): ModelInfo[] {
  if (provider) {
    return models.filter((m) => m.provider === provider);
  }
  return [...models];
}

export function getLatestModel(provider: string): ModelInfo | undefined {
  const providerModels = models.filter((m) => m.provider === provider);
  return providerModels[0];
}
