import { test } from "node:test";
import assert from "node:assert/strict";
import { reverseEdits, mapRangesThroughReplacement, chainFileAiRanges } from "./chain.js";
import { labelsFromRanges, type CharRange } from "./ledger.js";
import { tokenize } from "./tokenize.js";

function aiTexts(content: string, ranges: readonly CharRange[]): string[] {
  const labels = labelsFromRanges(content, ranges);
  return tokenize(content)
    .filter((_, index) => labels[index])
    .map((token) => token.text);
}

test("reverseEdits reconstructs the pre-edit content and the replacement steps", () => {
  const content = "const a = 2;\nconst b = 3;\n";
  const reversed = reverseEdits(content, [
    { oldString: "a = 1", newString: "a = 2", replaceAll: false },
    { oldString: "b = 1", newString: "b = 3", replaceAll: false },
  ]);
  assert.ok(reversed);
  assert.equal(reversed.before, "const a = 1;\nconst b = 1;\n");
  assert.equal(reversed.steps.length, 2);
});

test("reverseEdits refuses ambiguous or replace-all edits", () => {
  assert.equal(reverseEdits("x;\nx;\n", [{ oldString: "y;", newString: "x;", replaceAll: false }]), null);
  assert.equal(reverseEdits("x;\n", [{ oldString: "y;", newString: "x;", replaceAll: true }]), null);
});

test("mapRangesThroughReplacement keeps unchanged text and drops the replaced middle", () => {
  const mapped = mapRangesThroughReplacement(
    [
      [0, 3],
      [5, 9],
      [12, 15],
    ],
    { start: 4, oldText: "abcdef", newText: "abXYZZef" },
  );
  assert.deepEqual(mapped, [
    [0, 3],
    [5, 6],
    [10, 11],
    [14, 17],
  ]);
});

test("exact chain keeps earlier AI edits when nothing changed in between", () => {
  const previousContent = "function f() {\n  return 1;\n}\n";
  const previousRanges: CharRange[] = [[previousContent.indexOf("return"), previousContent.indexOf(";\n}") + 1]];
  const content = "function f() {\n  return 1;\n}\nfunction g() {\n  return 2;\n}\n";
  const result = chainFileAiRanges({
    call: { toolName: "Edit", toolInput: { old_string: "}\n", new_string: "}\nfunction g() {\n  return 2;\n}\n" } },
    content,
    deltaRanges: [[content.indexOf("function g"), content.length]],
    previous: { content: previousContent, fileAiRanges: previousRanges },
  });
  assert.equal(result.method, "exact");
  assert.deepEqual(aiTexts(content, result.fileAiRanges), ["return", "1", ";", "function", "g", "(", ")", "{", "return", "2", ";", "}"]);
});

test("propagated chain never labels text a human added in between", () => {
  const previousContent = "function total(items) {\n  let sum = computeSubtotal(items);\n  return sum;\n}\n";
  const previousRanges: CharRange[] = [[previousContent.indexOf("  let"), previousContent.indexOf("  return")]];
  const humanLine = "  audit(items);\n";
  const humanEdited = previousContent.replace("  return sum;", humanLine + "  return sum;");
  const content = humanEdited.replace("  return sum;", "  return Math.round(sum);");
  const result = chainFileAiRanges({
    call: { toolName: "Edit", toolInput: { old_string: "  return sum;", new_string: "  return Math.round(sum);" } },
    content,
    deltaRanges: [[content.indexOf("Math"), content.indexOf("(sum)")]],
    previous: { content: previousContent, fileAiRanges: previousRanges },
  });
  assert.equal(result.method, "propagated");
  const labels = labelsFromRanges(content, result.fileAiRanges);
  const tokens = tokenize(content);
  const auditStart = content.indexOf(humanLine);
  const auditEnd = auditStart + humanLine.length;
  assert.ok(tokens.every((token, index) => !(labels[index] && token.start >= auditStart && token.end <= auditEnd)));
  assert.ok(aiTexts(content, result.fileAiRanges).includes("computeSubtotal"));
});

test("a Write resets the chain to the whole file", () => {
  const content = "export const x = 1;\n";
  const result = chainFileAiRanges({
    call: { toolName: "Write", toolInput: { content } },
    content,
    deltaRanges: [[0, content.length]],
    previous: { content: "old", fileAiRanges: [[0, 3]] },
  });
  assert.equal(result.method, "write");
  assert.deepEqual(result.fileAiRanges, [[0, content.length]]);
});
