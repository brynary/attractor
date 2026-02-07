import type { Selector, Declaration, StylesheetRule } from "../types/index.js";

export function parseStylesheet(source: string): StylesheetRule[] {
  const rules: StylesheetRule[] = [];
  const trimmed = source.trim();
  if (trimmed === "") return rules;

  let pos = 0;

  function skipWhitespace(): void {
    while (pos < trimmed.length && /\s/.test(trimmed[pos] ?? "")) {
      pos++;
    }
  }

  function parseSelector(): Selector | undefined {
    skipWhitespace();
    if (pos >= trimmed.length) return undefined;

    const ch = trimmed[pos];
    if (ch === "*") {
      pos++;
      return { kind: "universal", value: "*", specificity: 0 };
    }
    if (ch === "#") {
      pos++;
      const start = pos;
      while (pos < trimmed.length && /[a-zA-Z0-9_-]/.test(trimmed[pos] ?? "")) {
        pos++;
      }
      const value = trimmed.slice(start, pos);
      if (value === "") return undefined;
      return { kind: "id", value, specificity: 2 };
    }
    if (ch === ".") {
      pos++;
      const start = pos;
      while (pos < trimmed.length && /[a-z0-9-]/.test(trimmed[pos] ?? "")) {
        pos++;
      }
      const value = trimmed.slice(start, pos);
      if (value === "") return undefined;
      return { kind: "class", value, specificity: 1 };
    }
    return undefined;
  }

  function parseDeclarations(): Declaration[] {
    const declarations: Declaration[] = [];
    skipWhitespace();

    while (pos < trimmed.length && trimmed[pos] !== "}") {
      skipWhitespace();
      if (pos >= trimmed.length || trimmed[pos] === "}") break;

      // Parse property name
      const propStart = pos;
      while (pos < trimmed.length && trimmed[pos] !== ":" && trimmed[pos] !== "}") {
        pos++;
      }
      const property = trimmed.slice(propStart, pos).trim();
      if (trimmed[pos] !== ":") break;
      pos++; // skip ':'

      // Parse value
      const valStart = pos;
      while (pos < trimmed.length && trimmed[pos] !== ";" && trimmed[pos] !== "}") {
        pos++;
      }
      const value = trimmed.slice(valStart, pos).trim();

      if (property !== "" && value !== "") {
        declarations.push({ property, value });
      }

      if (pos < trimmed.length && trimmed[pos] === ";") {
        pos++; // skip ';'
      }
    }

    return declarations;
  }

  while (pos < trimmed.length) {
    const selector = parseSelector();
    if (selector === undefined) break;

    skipWhitespace();
    if (pos >= trimmed.length || trimmed[pos] !== "{") break;
    pos++; // skip '{'

    const declarations = parseDeclarations();

    skipWhitespace();
    if (pos < trimmed.length && trimmed[pos] === "}") {
      pos++; // skip '}'
    }

    if (declarations.length > 0) {
      rules.push({ selector, declarations });
    }

    skipWhitespace();
  }

  return rules;
}
