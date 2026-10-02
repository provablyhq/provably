export interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TOKEN_RE = /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;

export function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  for (const match of content.matchAll(TOKEN_RE)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}
