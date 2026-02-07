const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(raw: string): number {
  const match = raw.match(/^(-?\d+)\s*(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration: "${raw}"`);
  }
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multiplier = UNIT_TO_MS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit: "${unit}"`);
  }
  return value * multiplier;
}

export function isDurationString(value: string): boolean {
  return /^-?\d+\s*(ms|s|m|h|d)$/.test(value);
}
