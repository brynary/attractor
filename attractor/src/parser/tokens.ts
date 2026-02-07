export const TokenKind = {
  DIGRAPH: "DIGRAPH",
  GRAPH: "GRAPH",
  NODE: "NODE",
  EDGE: "EDGE",
  SUBGRAPH: "SUBGRAPH",
  TRUE: "TRUE",
  FALSE: "FALSE",
  IDENTIFIER: "IDENTIFIER",
  STRING: "STRING",
  INTEGER: "INTEGER",
  FLOAT: "FLOAT",
  DURATION: "DURATION",
  ARROW: "ARROW",
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  LBRACKET: "LBRACKET",
  RBRACKET: "RBRACKET",
  EQUALS: "EQUALS",
  COMMA: "COMMA",
  SEMICOLON: "SEMICOLON",
  DOT: "DOT",
  EOF: "EOF",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
}
