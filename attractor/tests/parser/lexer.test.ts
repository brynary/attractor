import { describe, expect, test } from "bun:test";
import { tokenize, LexerError } from "../../src/parser/lexer.js";
import { TokenKind } from "../../src/parser/tokens.js";

describe("lexer", () => {
  test("tokenizes digraph keyword", () => {
    const tokens = tokenize("digraph");
    expect(tokens[0]?.kind).toBe(TokenKind.DIGRAPH);
    expect(tokens[1]?.kind).toBe(TokenKind.EOF);
  });

  test("tokenizes all keywords", () => {
    const tokens = tokenize("digraph graph node edge subgraph true false");
    expect(tokens[0]?.kind).toBe(TokenKind.DIGRAPH);
    expect(tokens[1]?.kind).toBe(TokenKind.GRAPH);
    expect(tokens[2]?.kind).toBe(TokenKind.NODE);
    expect(tokens[3]?.kind).toBe(TokenKind.EDGE);
    expect(tokens[4]?.kind).toBe(TokenKind.SUBGRAPH);
    expect(tokens[5]?.kind).toBe(TokenKind.TRUE);
    expect(tokens[6]?.kind).toBe(TokenKind.FALSE);
    expect(tokens[7]?.kind).toBe(TokenKind.EOF);
  });

  test("tokenizes identifiers", () => {
    const tokens = tokenize("foo bar_baz _x A123");
    expect(tokens[0]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[0]?.value).toBe("foo");
    expect(tokens[1]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[1]?.value).toBe("bar_baz");
    expect(tokens[2]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[2]?.value).toBe("_x");
    expect(tokens[3]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[3]?.value).toBe("A123");
  });

  test("tokenizes simple string", () => {
    const tokens = tokenize('"hello world"');
    expect(tokens[0]?.kind).toBe(TokenKind.STRING);
    expect(tokens[0]?.value).toBe("hello world");
  });

  test("tokenizes string with escape sequences", () => {
    const tokens = tokenize('"line1\\nline2\\t\\"quoted\\\\"');
    expect(tokens[0]?.kind).toBe(TokenKind.STRING);
    expect(tokens[0]?.value).toBe('line1\nline2\t"quoted\\');
  });

  test("tokenizes integers", () => {
    const tokens = tokenize("42 -1 0");
    expect(tokens[0]?.kind).toBe(TokenKind.INTEGER);
    expect(tokens[0]?.value).toBe("42");
    expect(tokens[1]?.kind).toBe(TokenKind.INTEGER);
    expect(tokens[1]?.value).toBe("-1");
    expect(tokens[2]?.kind).toBe(TokenKind.INTEGER);
    expect(tokens[2]?.value).toBe("0");
  });

  test("tokenizes floats", () => {
    const tokens = tokenize("0.5 -3.14");
    expect(tokens[0]?.kind).toBe(TokenKind.FLOAT);
    expect(tokens[0]?.value).toBe("0.5");
    expect(tokens[1]?.kind).toBe(TokenKind.FLOAT);
    expect(tokens[1]?.value).toBe("-3.14");
  });

  test("tokenizes duration values", () => {
    const tokens = tokenize("900s 15m 2h 250ms 1d");
    expect(tokens[0]?.kind).toBe(TokenKind.DURATION);
    expect(tokens[0]?.value).toBe("900s");
    expect(tokens[1]?.kind).toBe(TokenKind.DURATION);
    expect(tokens[1]?.value).toBe("15m");
    expect(tokens[2]?.kind).toBe(TokenKind.DURATION);
    expect(tokens[2]?.value).toBe("2h");
    expect(tokens[3]?.kind).toBe(TokenKind.DURATION);
    expect(tokens[3]?.value).toBe("250ms");
    expect(tokens[4]?.kind).toBe(TokenKind.DURATION);
    expect(tokens[4]?.value).toBe("1d");
  });

  test("tokenizes arrow operator", () => {
    const tokens = tokenize("A -> B");
    expect(tokens[0]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[1]?.kind).toBe(TokenKind.ARROW);
    expect(tokens[2]?.kind).toBe(TokenKind.IDENTIFIER);
  });

  test("tokenizes brackets and braces", () => {
    const tokens = tokenize("{ } [ ]");
    expect(tokens[0]?.kind).toBe(TokenKind.LBRACE);
    expect(tokens[1]?.kind).toBe(TokenKind.RBRACE);
    expect(tokens[2]?.kind).toBe(TokenKind.LBRACKET);
    expect(tokens[3]?.kind).toBe(TokenKind.RBRACKET);
  });

  test("tokenizes equals, comma, semicolon, dot", () => {
    const tokens = tokenize("= , ; .");
    expect(tokens[0]?.kind).toBe(TokenKind.EQUALS);
    expect(tokens[1]?.kind).toBe(TokenKind.COMMA);
    expect(tokens[2]?.kind).toBe(TokenKind.SEMICOLON);
    expect(tokens[3]?.kind).toBe(TokenKind.DOT);
  });

  test("strips line comments", () => {
    const tokens = tokenize("A // comment\nB");
    expect(tokens[0]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[0]?.value).toBe("A");
    expect(tokens[1]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[1]?.value).toBe("B");
    expect(tokens[2]?.kind).toBe(TokenKind.EOF);
  });

  test("strips block comments", () => {
    const tokens = tokenize("A /* block\ncomment */ B");
    expect(tokens[0]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[0]?.value).toBe("A");
    expect(tokens[1]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[1]?.value).toBe("B");
    expect(tokens[2]?.kind).toBe(TokenKind.EOF);
  });

  test("rejects undirected edge operator", () => {
    expect(() => tokenize("A -- B")).toThrow(LexerError);
  });

  test("rejects unterminated string", () => {
    expect(() => tokenize('"hello')).toThrow(LexerError);
  });

  test("rejects unterminated block comment", () => {
    expect(() => tokenize("/* unterminated")).toThrow(LexerError);
  });

  test("rejects unexpected character", () => {
    expect(() => tokenize("@")).toThrow(LexerError);
  });

  test("tracks line and column numbers", () => {
    const tokens = tokenize("A\n  B");
    expect(tokens[0]?.line).toBe(1);
    expect(tokens[0]?.column).toBe(1);
    expect(tokens[1]?.line).toBe(2);
    expect(tokens[1]?.column).toBe(3);
  });

  test("distinguishes duration from identifier starting with unit letter", () => {
    // "15minutes" should be INTEGER(15) + IDENTIFIER(minutes), not DURATION
    const tokens = tokenize("15minutes");
    expect(tokens[0]?.kind).toBe(TokenKind.INTEGER);
    expect(tokens[0]?.value).toBe("15");
    expect(tokens[1]?.kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[1]?.value).toBe("minutes");
  });
});
