export const FidelityMode = {
  FULL: "full",
  TRUNCATE: "truncate",
  COMPACT: "compact",
  SUMMARY_LOW: "summary:low",
  SUMMARY_MEDIUM: "summary:medium",
  SUMMARY_HIGH: "summary:high",
} as const;

export type FidelityMode = (typeof FidelityMode)[keyof typeof FidelityMode];

const VALID_MODES = new Set<string>(Object.values(FidelityMode));

export function isValidFidelityMode(value: string): value is FidelityMode {
  return VALID_MODES.has(value);
}
