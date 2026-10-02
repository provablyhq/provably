import type { LabeledToken } from "./propagate.js";

export interface LineProvenance {
  readonly lineNumber: number;
  readonly text: string;
  readonly totalTokenCount: number;
  readonly aiTokenCount: number;
  readonly aiRatio: number;
}

export function rollupByLine(content: string, tokens: readonly LabeledToken[]): LineProvenance[] {
  const lineTexts = content.split("\n");
  const lineStartOffsets = computeLineStartOffsets(content, lineTexts.length);

  const totalTokenCounts = new Array<number>(lineTexts.length).fill(0);
  const aiTokenCounts = new Array<number>(lineTexts.length).fill(0);

  for (const token of tokens) {
    const lineIndex = lineIndexForOffset(lineStartOffsets, token.start);
    totalTokenCounts[lineIndex]!++;
    if (token.ai) aiTokenCounts[lineIndex]!++;
  }

  return lineTexts.map((text, lineIndex) => {
    const totalTokenCount = totalTokenCounts[lineIndex]!;
    const aiTokenCount = aiTokenCounts[lineIndex]!;
    return {
      lineNumber: lineIndex + 1,
      text,
      totalTokenCount,
      aiTokenCount,
      aiRatio: totalTokenCount === 0 ? 0 : aiTokenCount / totalTokenCount,
    };
  });
}

function computeLineStartOffsets(content: string, lineCount: number): number[] {
  const offsets = new Array<number>(lineCount);
  offsets[0] = 0;
  let lineIndex = 1;
  for (let charIndex = 0; charIndex < content.length; charIndex++) {
    if (content[charIndex] === "\n") {
      offsets[lineIndex] = charIndex + 1;
      lineIndex++;
    }
  }
  return offsets;
}

function lineIndexForOffset(lineStartOffsets: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStartOffsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStartOffsets[mid]! <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}
