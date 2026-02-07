export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutput?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  aliases: string[];
}
