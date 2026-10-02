export interface AlignedPair {
  readonly oldIndex: number;
  readonly newIndex: number;
}

export function alignTokens(oldTokens: readonly string[], newTokens: readonly string[]): AlignedPair[] {
  const oldLength = oldTokens.length;
  const newLength = newTokens.length;

  const lengthTable: number[][] = Array.from({ length: oldLength + 1 }, () =>
    new Array<number>(newLength + 1).fill(0),
  );

  for (let oldIndex = oldLength - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLength - 1; newIndex >= 0; newIndex--) {
      if (oldTokens[oldIndex] === newTokens[newIndex]) {
        lengthTable[oldIndex]![newIndex] = lengthTable[oldIndex + 1]![newIndex + 1]! + 1;
      } else {
        lengthTable[oldIndex]![newIndex] = Math.max(
          lengthTable[oldIndex + 1]![newIndex]!,
          lengthTable[oldIndex]![newIndex + 1]!,
        );
      }
    }
  }

  const pairs: AlignedPair[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  while (oldCursor < oldLength && newCursor < newLength) {
    if (oldTokens[oldCursor] === newTokens[newCursor]) {
      pairs.push({ oldIndex: oldCursor, newIndex: newCursor });
      oldCursor++;
      newCursor++;
    } else if (lengthTable[oldCursor + 1]![newCursor]! >= lengthTable[oldCursor]![newCursor + 1]!) {
      oldCursor++;
    } else {
      newCursor++;
    }
  }
  return pairs;
}
