import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "./tokenize.js";
import { propagateLabels } from "./propagate.js";
import { rollupByLine } from "./lines.js";
import { labelsFromRanges } from "./ledger.js";

function aiTokenTexts(oldContent: string, oldLabels: boolean[], newContent: string): string[] {
  const result = propagateLabels(oldContent, oldLabels, newContent);
  return result.tokens.filter((token) => token.ai).map((token) => token.text);
}

test("unchanged content preserves every AI label", () => {
  const content = "const answer = compute(value);";
  const labels = tokenize(content).map(() => true);
  const result = propagateLabels(content, labels, content);
  assert.deepEqual([...result.labels], labels);
  assert.equal(result.insertedCount, 0);
});

test("pure reformatting carries AI labels across whitespace changes", () => {
  const oldContent = "function f(){return 1;}";
  const newContent = "function f() {\n  return 1;\n}\n";
  const labels = tokenize(oldContent).map(() => true);
  const result = propagateLabels(oldContent, labels, newContent);
  assert.ok(result.labels.every((label) => label === true));
});

test("human-inserted tokens are never flagged AI", () => {
  const oldContent = "const a = 1;\n";
  const oldLabels = tokenize(oldContent).map(() => true);
  const newContent = "const a = 1;\nconst humanAdded = 2;\n";
  const result = propagateLabels(oldContent, oldLabels, newContent);
  const inserted = result.tokens.filter((token) => ["humanAdded", "2"].includes(token.text));
  assert.ok(inserted.length > 0);
  assert.ok(inserted.every((token) => token.ai === false));
});

test("deleting AI code drops its labels without affecting survivors", () => {
  const oldContent = "const ai = 1;\nconst survivor = 2;\n";
  const oldLabels = tokenize(oldContent).map(() => true);
  const newContent = "const survivor = 2;\n";
  const survivingAi = aiTokenTexts(oldContent, oldLabels, newContent);
  assert.ok(survivingAi.includes("survivor"));
  assert.ok(!survivingAi.includes("ai"));
});

test("ledger ranges only label tokens inside the AI region", () => {
  const content = "const human = 0;\nconst ai = 1;\n";
  const aiStart = content.indexOf("const ai");
  const labels = labelsFromRanges(content, [[aiStart, content.length]]);
  const tokens = tokenize(content);
  const labeled = tokens.filter((token, index) => labels[index]).map((token) => token.text);
  assert.deepEqual(labeled, ["const", "ai", "=", "1", ";"]);
});

test("line rollup reports per-line AI ratio", () => {
  const content = "const a = 1;\nconst b = 2;\n";
  const aiStart = content.indexOf("const b");
  const labels = labelsFromRanges(content, [[aiStart, content.length]]);
  const tokens = tokenize(content).map((token, index) => ({ ...token, ai: labels[index]! }));
  const lines = rollupByLine(content, tokens);
  assert.equal(lines[0]!.aiRatio, 0);
  assert.equal(lines[1]!.aiRatio, 1);
});

test("confidence gate stops AI labels leaking onto reused boilerplate", () => {
  const oldContent = "function h() {\n  log('a');\n  log('b');\n}\n";
  const oldLabels = labelsFromRanges(oldContent, [[oldContent.indexOf("  log('a')"), oldContent.indexOf("}")]]);
  const newContent = "function h() {\n  log('c');\n}\n";

  const gated = propagateLabels(oldContent, oldLabels, newContent);
  assert.ok(gated.tokens.every((token) => token.ai === false));

  const ungated = propagateLabels(oldContent, oldLabels, newContent, { confidenceGate: false });
  assert.ok(ungated.tokens.some((token) => token.ai === true));
});

test("confidence gate still carries labels through distinctive tokens", () => {
  const content = "const subtotalForOrder = computeOrderTotal();";
  const labels = tokenize(content).map(() => true);
  const result = propagateLabels(content, labels, content);
  assert.ok(result.labels.every((label) => label === true));
});

test("editing one AI line leaves other AI lines intact", () => {
  const oldContent = "let x = oldValue;\nlet y = keep;\n";
  const oldLabels = tokenize(oldContent).map(() => true);
  const newContent = "let x = newValue;\nlet y = keep;\n";
  const result = propagateLabels(oldContent, oldLabels, newContent);
  const lines = rollupByLine(newContent, result.tokens);
  assert.equal(lines[1]!.aiRatio, 1);
  const newValueToken = result.tokens.find((token) => token.text === "newValue");
  assert.equal(newValueToken?.ai, false);
});
