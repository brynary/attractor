/**
 * Type-safe extraction helpers for untyped JSON objects.
 * These replace `as` casts when working with raw API responses.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

export function optNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function rec(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function recArray(value: unknown): Record<string, unknown>[] {
  return isRecordArray(value) ? value : [];
}

export function recOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
