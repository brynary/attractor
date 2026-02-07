export { TokenKind } from "./tokens.js";
export type { Token, TokenKind as TokenKindType } from "./tokens.js";
export { tokenize, LexerError } from "./lexer.js";
export { parseTokens, ParseError } from "./parser.js";

import type { Graph } from "../types/index.js";
import { tokenize } from "./lexer.js";
import { parseTokens } from "./parser.js";

export function parse(input: string): Graph {
  const tokens = tokenize(input);
  return parseTokens(tokens);
}
