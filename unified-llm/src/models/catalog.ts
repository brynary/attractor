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
    contextWindow: 1_047_576,
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
    contextWindow: 1_047_576,
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
    contextWindow: 1_047_576,
    maxOutput: 16_384,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 10,
    outputCostPerMillion: 30,
    aliases: ["gpt-codex", "codex"],
  },
  {
    id: "gemini-3-pro-preview",
    provider: "gemini",
    displayName: "Gemini 3 Pro Preview",
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    aliases: ["gemini-pro", "gemini-3-pro"],
  },
  {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    displayName: "Gemini 3 Flash Preview",
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    inputCostPerMillion: 0.3,
    outputCostPerMillion: 2.5,
    aliases: ["gemini-flash", "gemini-3-flash"],
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

export function getLatestModel(
  provider: string,
  capability?: "reasoning" | "vision" | "tools",
): ModelInfo | undefined {
  let filtered = models.filter((m) => m.provider === provider);
  if (capability === "reasoning") {
    filtered = filtered.filter((m) => m.supportsReasoning);
  } else if (capability === "vision") {
    filtered = filtered.filter((m) => m.supportsVision);
  } else if (capability === "tools") {
    filtered = filtered.filter((m) => m.supportsTools);
  }
  return filtered[0];
}
