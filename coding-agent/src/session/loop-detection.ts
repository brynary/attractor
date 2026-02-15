import { createHash } from "crypto";
import type { Turn, AssistantTurn } from "../types/session.js";

function isAssistantTurn(turn: Turn): turn is AssistantTurn {
  return turn.kind === "assistant";
}

/**
 * Walk history backwards and extract tool call signatures (name + serialized args).
 * Returns up to `count` signatures in chronological order.
 */
export function extractToolCallSignatures(
  history: Turn[],
  count: number,
): string[] {
  const signatures: string[] = [];

  for (let i = history.length - 1; i >= 0 && signatures.length < count; i--) {
    const turn = history[i];
    if (turn === undefined || !isAssistantTurn(turn)) continue;

    // Walk tool calls in reverse so we collect most-recent-first
    for (
      let j = turn.toolCalls.length - 1;
      j >= 0 && signatures.length < count;
      j--
    ) {
      const tc = turn.toolCalls[j];
      if (tc === undefined) continue;
      signatures.push(`${tc.name}:${hashArguments(tc.arguments)}`);
    }
  }

  // Reverse to chronological order
  signatures.reverse();
  return signatures;
}

function hashArguments(args: unknown): string {
  const canonical = stableStringify(args);
  return createHash("sha256").update(canonical).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
  );
  return `{${pairs.join(",")}}`;
}

/**
 * Detect repeating tool-call patterns in recent history.
 *
 * Checks for repeating patterns of length 1, 2, and 3 within the
 * last `windowSize` tool call signatures.
 */
export function detectLoop(history: Turn[], windowSize: number): boolean {
  const signatures = extractToolCallSignatures(history, windowSize);

  if (signatures.length < windowSize) {
    return false;
  }

  for (const patternLen of [1, 2, 3]) {
    if (windowSize % patternLen !== 0) continue;

    const pattern = signatures.slice(0, patternLen);
    let matches = true;

    for (let chunk = 1; chunk < windowSize / patternLen; chunk++) {
      for (let k = 0; k < patternLen; k++) {
        if (signatures[chunk * patternLen + k] !== pattern[k]) {
          matches = false;
          break;
        }
      }
      if (!matches) break;
    }

    if (matches) return true;
  }

  return false;
}
