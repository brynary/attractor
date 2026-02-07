export type SafeJsonResult =
  | { success: true; value: unknown }
  | { success: false; error: Error };

export function safeJsonParse(text: string): SafeJsonResult {
  try {
    return { success: true, value: JSON.parse(text) };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

export function partialJsonParse(text: string): unknown {
  // Try parsing as-is first
  try {
    return JSON.parse(text);
  } catch {
    // Try to fix common incomplete JSON issues
  }

  // Try closing brackets/braces
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  // Count unclosed brackets and braces
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escaped = false;

  for (const ch of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") braceCount++;
    else if (ch === "}") braceCount--;
    else if (ch === "[") bracketCount++;
    else if (ch === "]") bracketCount--;
  }

  // Close any open strings, then add closing brackets/braces
  let repaired = trimmed;
  if (inString) {
    repaired += '"';
  }

  // Remove trailing comma if present before closing
  repaired = repaired.replace(/,\s*$/, "");

  // Close brackets and braces
  while (bracketCount > 0) {
    repaired += "]";
    bracketCount--;
  }
  while (braceCount > 0) {
    repaired += "}";
    braceCount--;
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}
