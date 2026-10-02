import { tokenize, type Token } from "./tokenize.js";
import { alignTokens, type AlignedPair } from "./lcs.js";

export interface LabeledToken extends Token {
  readonly ai: boolean;
}

export interface PropagationResult {
  readonly tokens: readonly LabeledToken[];
  readonly labels: readonly boolean[];
  readonly carriedCount: number;
  readonly insertedCount: number;
}

export type AnchorStrength = "unique" | "distinctive";

export interface PropagationOptions {
  readonly confidenceGate?: boolean;
  readonly anchorStrength?: AnchorStrength;
}

const NON_DISTINCTIVE_WORDS = new Set([
  "abstract", "and", "as", "async", "await", "begin", "break", "case", "catch", "class", "const", "continue",
  "def", "default", "delete", "do", "elif", "else", "end", "enum", "except", "export", "extends", "false",
  "final", "finally", "fn", "for", "from", "func", "function", "if", "impl", "implements", "import", "in",
  "instanceof", "interface", "is", "lambda", "let", "match", "mod", "mut", "new", "nil", "none", "not", "null",
  "of", "or", "pass", "private", "protected", "pub", "public", "readonly", "return", "self", "static", "struct",
  "super", "switch", "then", "this", "throw", "true", "try", "type", "typeof", "undefined", "use", "var", "void",
  "while", "with", "yield",
]);

function isDistinctiveToken(text: string): boolean {
  return /^[A-Za-z0-9_]{3,}$/.test(text) && !NON_DISTINCTIVE_WORDS.has(text.toLowerCase());
}

export function propagateLabels(
  oldContent: string,
  oldLabels: readonly boolean[],
  newContent: string,
  options: PropagationOptions = {},
): PropagationResult {
  const confidenceGate = options.confidenceGate ?? true;
  const oldTokens = tokenize(oldContent);
  if (oldTokens.length !== oldLabels.length) {
    throw new Error(
      `oldLabels length ${oldLabels.length} does not match tokenized oldContent length ${oldTokens.length}`,
    );
  }
  const newTokens = tokenize(newContent);
  const oldTexts = oldTokens.map((token) => token.text);
  const newTexts = newTokens.map((token) => token.text);
  const pairs = alignTokens(oldTexts, newTexts);

  const carryablePairs = confidenceGate
    ? strongAnchoredPairs(pairs, oldTexts, newTexts, oldLabels, options.anchorStrength ?? "unique")
    : pairs;

  const newLabels = new Array<boolean>(newTokens.length).fill(false);
  let carriedCount = 0;
  for (const pair of carryablePairs) {
    if (oldLabels[pair.oldIndex]) {
      newLabels[pair.newIndex] = true;
      carriedCount++;
    }
  }

  const labeledTokens: LabeledToken[] = newTokens.map((token, tokenIndex) => ({
    ...token,
    ai: newLabels[tokenIndex]!,
  }));

  return {
    tokens: labeledTokens,
    labels: newLabels,
    carriedCount,
    insertedCount: newTokens.length - pairs.length,
  };
}

function strongAnchoredPairs(
  pairs: readonly AlignedPair[],
  oldTexts: readonly string[],
  newTexts: readonly string[],
  oldLabels: readonly boolean[],
  anchorStrength: AnchorStrength,
): AlignedPair[] {
  const oldFrequency = countFrequencies(oldTexts);
  const newFrequency = countFrequencies(newTexts);
  const carryable: AlignedPair[] = [];

  for (const run of contiguousRuns(pairs)) {
    const hasStrongAiAnchor = run.some((pair) => {
      const text = oldTexts[pair.oldIndex]!;
      const unique = oldLabels[pair.oldIndex] === true && oldFrequency.get(text) === 1 && newFrequency.get(text) === 1;
      return unique && (anchorStrength === "unique" || isDistinctiveToken(text));
    });
    if (hasStrongAiAnchor) carryable.push(...run);
  }
  return carryable;
}

function contiguousRuns(pairs: readonly AlignedPair[]): AlignedPair[][] {
  const runs: AlignedPair[][] = [];
  let current: AlignedPair[] = [];
  for (const pair of pairs) {
    const previous = current[current.length - 1];
    if (previous && pair.oldIndex === previous.oldIndex + 1 && pair.newIndex === previous.newIndex + 1) {
      current.push(pair);
    } else {
      if (current.length > 0) runs.push(current);
      current = [pair];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function countFrequencies(texts: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const text of texts) {
    frequencies.set(text, (frequencies.get(text) ?? 0) + 1);
  }
  return frequencies;
}
