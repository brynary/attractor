/**
 * Normalize a label for comparison: lowercase, trim, strip accelerator prefix.
 */
export function normalizeLabel(label: string): string {
  let s = label.trim().toLowerCase();
  s = stripAcceleratorPrefix(s);
  return s.trim();
}

/**
 * Strip accelerator key patterns from the beginning of a label.
 * Patterns: "[K] ", "K) ", "K - "
 */
function stripAcceleratorPrefix(label: string): string {
  // [K] Label
  const bracketMatch = label.match(/^\[(.)\]\s*/);
  if (bracketMatch) {
    return label.slice(bracketMatch[0].length);
  }

  // K) Label
  const parenMatch = label.match(/^(.)\)\s*/);
  if (parenMatch) {
    return label.slice(parenMatch[0].length);
  }

  // K - Label
  const dashMatch = label.match(/^(.)\s*-\s*/);
  if (dashMatch) {
    return label.slice(dashMatch[0].length);
  }

  return label;
}

/**
 * Extract the accelerator key from a label.
 * Returns the key character, or the first character of the label.
 */
export function parseAcceleratorKey(label: string): string {
  // [K] Label
  const bracketMatch = label.match(/^\[(.)\]/);
  if (bracketMatch?.[1]) return bracketMatch[1].toUpperCase();

  // K) Label
  const parenMatch = label.match(/^(.)\)/);
  if (parenMatch?.[1]) return parenMatch[1].toUpperCase();

  // K - Label
  const dashMatch = label.match(/^(.)\s*-\s/);
  if (dashMatch?.[1]) return dashMatch[1].toUpperCase();

  // First character
  if (label.length > 0) return label[0]!.toUpperCase();
  return "";
}

/**
 * Derive a CSS class name from a subgraph label.
 * Lowercase, replace spaces with hyphens, strip non-alphanumeric (except hyphens).
 */
export function deriveClassName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
