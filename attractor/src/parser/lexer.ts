import { TokenKind, type Token } from "./tokens.js";

const KEYWORDS: Record<string, TokenKind> = {
  digraph: TokenKind.DIGRAPH,
  graph: TokenKind.GRAPH,
  node: TokenKind.NODE,
  edge: TokenKind.EDGE,
  subgraph: TokenKind.SUBGRAPH,
  true: TokenKind.TRUE,
  false: TokenKind.FALSE,
};

const DURATION_UNITS = new Set(["ms", "s", "m", "h", "d"]);

export class LexerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = "LexerError";
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function peek(): string {
    return input.charAt(pos);
  }

  function peekAt(offset: number): string {
    return input.charAt(pos + offset);
  }

  function advance(): string {
    const ch = input.charAt(pos);
    pos++;
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  }

  function skipWhitespace(): void {
    while (pos < input.length) {
      const ch = peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        advance();
      } else {
        break;
      }
    }
  }

  function skipLineComment(): void {
    // skip past //
    advance();
    advance();
    while (pos < input.length && peek() !== "\n") {
      advance();
    }
  }

  function skipBlockComment(): void {
    const startLine = line;
    const startCol = column;
    // skip past /*
    advance();
    advance();
    while (pos < input.length) {
      if (peek() === "*" && peekAt(1) === "/") {
        advance();
        advance();
        return;
      }
      advance();
    }
    throw new LexerError("Unterminated block comment", startLine, startCol);
  }

  function readString(): Token {
    const startLine = line;
    const startCol = column;
    advance(); // skip opening quote
    let value = "";
    while (pos < input.length) {
      const ch = peek();
      if (ch === "\\") {
        advance();
        const escaped = peek();
        if (escaped === '"') {
          value += '"';
        } else if (escaped === "n") {
          value += "\n";
        } else if (escaped === "t") {
          value += "\t";
        } else if (escaped === "\\") {
          value += "\\";
        } else {
          throw new LexerError(
            `Invalid escape sequence: \\${escaped}`,
            line,
            column,
          );
        }
        advance();
      } else if (ch === '"') {
        advance(); // skip closing quote
        return { kind: TokenKind.STRING, value, line: startLine, column: startCol };
      } else {
        value += ch;
        advance();
      }
    }
    throw new LexerError("Unterminated string", startLine, startCol);
  }

  function readNumberOrDuration(): Token {
    const startLine = line;
    const startCol = column;
    let value = "";
    let hasDecimal = false;

    if (peek() === "-") {
      value += advance();
    }

    while (pos < input.length && peek() >= "0" && peek() <= "9") {
      value += advance();
    }

    if (peek() === "." && peekAt(1) >= "0" && peekAt(1) <= "9") {
      hasDecimal = true;
      value += advance(); // the dot
      while (pos < input.length && peek() >= "0" && peek() <= "9") {
        value += advance();
      }
    }

    // Check for duration suffix (only on integers)
    if (!hasDecimal) {
      let suffix = "";
      if (peek() === "m" && peekAt(1) === "s") {
        suffix = "ms";
      } else if (DURATION_UNITS.has(peek())) {
        suffix = peek();
      }

      if (suffix.length > 0) {
        // Check the character after the suffix is not an identifier character
        const afterSuffix = peekAt(suffix.length);
        const isIdentContinue =
          (afterSuffix >= "a" && afterSuffix <= "z") ||
          (afterSuffix >= "A" && afterSuffix <= "Z") ||
          (afterSuffix >= "0" && afterSuffix <= "9") ||
          afterSuffix === "_";
        if (!isIdentContinue) {
          for (const _ of suffix) {
            advance();
          }
          return {
            kind: TokenKind.DURATION,
            value: value + suffix,
            line: startLine,
            column: startCol,
          };
        }
      }
    }

    if (hasDecimal) {
      return { kind: TokenKind.FLOAT, value, line: startLine, column: startCol };
    }
    return { kind: TokenKind.INTEGER, value, line: startLine, column: startCol };
  }

  function readIdentifierOrKeyword(): Token {
    const startLine = line;
    const startCol = column;
    let value = "";
    while (pos < input.length) {
      const ch = peek();
      if (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "_"
      ) {
        value += advance();
      } else {
        break;
      }
    }

    const keyword = KEYWORDS[value];
    if (keyword !== undefined) {
      return { kind: keyword, value, line: startLine, column: startCol };
    }

    return { kind: TokenKind.IDENTIFIER, value, line: startLine, column: startCol };
  }

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    const ch = peek();
    const startLine = line;
    const startCol = column;

    // Comments
    if (ch === "/" && peekAt(1) === "/") {
      skipLineComment();
      continue;
    }
    if (ch === "/" && peekAt(1) === "*") {
      skipBlockComment();
      continue;
    }

    // Strings
    if (ch === '"') {
      tokens.push(readString());
      continue;
    }

    // Numbers and durations
    if (ch >= "0" && ch <= "9") {
      tokens.push(readNumberOrDuration());
      continue;
    }
    if (ch === "-" && peekAt(1) >= "0" && peekAt(1) <= "9") {
      // Check it's not the arrow operator
      if (peekAt(1) !== ">") {
        tokens.push(readNumberOrDuration());
        continue;
      }
    }

    // Arrow
    if (ch === "-" && peekAt(1) === ">") {
      advance();
      advance();
      tokens.push({ kind: TokenKind.ARROW, value: "->", line: startLine, column: startCol });
      continue;
    }

    // Undirected edge -- (to produce a useful error later)
    if (ch === "-" && peekAt(1) === "-") {
      throw new LexerError(
        "Undirected edges (--) are not supported; use directed edges (->)",
        startLine,
        startCol,
      );
    }

    // Single-character tokens
    if (ch === "{") {
      advance();
      tokens.push({ kind: TokenKind.LBRACE, value: "{", line: startLine, column: startCol });
      continue;
    }
    if (ch === "}") {
      advance();
      tokens.push({ kind: TokenKind.RBRACE, value: "}", line: startLine, column: startCol });
      continue;
    }
    if (ch === "[") {
      advance();
      tokens.push({ kind: TokenKind.LBRACKET, value: "[", line: startLine, column: startCol });
      continue;
    }
    if (ch === "]") {
      advance();
      tokens.push({ kind: TokenKind.RBRACKET, value: "]", line: startLine, column: startCol });
      continue;
    }
    if (ch === "=") {
      advance();
      tokens.push({ kind: TokenKind.EQUALS, value: "=", line: startLine, column: startCol });
      continue;
    }
    if (ch === ",") {
      advance();
      tokens.push({ kind: TokenKind.COMMA, value: ",", line: startLine, column: startCol });
      continue;
    }
    if (ch === ";") {
      advance();
      tokens.push({ kind: TokenKind.SEMICOLON, value: ";", line: startLine, column: startCol });
      continue;
    }
    if (ch === ".") {
      advance();
      tokens.push({ kind: TokenKind.DOT, value: ".", line: startLine, column: startCol });
      continue;
    }

    // Identifiers and keywords
    if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      ch === "_"
    ) {
      tokens.push(readIdentifierOrKeyword());
      continue;
    }

    throw new LexerError(`Unexpected character: '${ch}'`, startLine, startCol);
  }

  tokens.push({ kind: TokenKind.EOF, value: "", line, column });
  return tokens;
}
