import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, blameLineOrigins } from "./git.js";
import { hashContent, labelsFromRanges, type LedgerEvent } from "./ledger.js";
import { propagateLabels } from "./propagate.js";
import { rollupByLine } from "./lines.js";
import { tokenize } from "./tokenize.js";
import {
  anchoredAiLinesForFile,
  vetoLines,
  resolveFileProvenanceFromHistory,
  commitAnchorsForFile,
  keepOnlyVerbatimAiLines,
} from "./resolve.js";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "provably-git-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  writeFileSync(join(dir, file), content);
  git(dir, ["add", file]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

function makeEvent(file: string, content: string, aiRanges: [number, number][]): LedgerEvent {
  return {
    v: 1,
    id: "test-event",
    ts: "2026-10-02T00:00:00.000Z",
    tool: "claude-code",
    model: "claude-opus-4-8",
    file,
    contentSha256: hashContent(content),
    aiRanges,
  };
}

test("git veto removes the verbatim-collision false flag", () => {
  const dir = initRepo();
  try {
    const file = "pick.js";
    const aiContent =
      "function pick(values) {\n  if (values.length === 0) {\n    return null;\n  }\n  return values[0];\n}\n";
    commit(dir, file, aiContent, "ai: add pick");
    const event = makeEvent(file, aiContent, [
      [aiContent.indexOf("  if"), aiContent.indexOf("  return values")],
    ]);

    const headContent = "function pick(values) {\n  return null;\n}\n";
    commit(dir, file, headContent, "human: simplify");

    const baseLabels = labelsFromRanges(aiContent, event.aiRanges);
    const propagation = propagateLabels(aiContent, baseLabels, headContent);
    const lines = rollupByLine(headContent, propagation.tokens);

    const leakedLine = lines.find((line) => line.text.includes("return null"));
    assert.ok(leakedLine && leakedLine.aiRatio > 0, "precondition: content matching leaks AI onto the human line");

    const lineOrigins = blameLineOrigins(dir, "HEAD", file);
    const anchoredAiLines = anchoredAiLinesForFile(dir, "HEAD", file, [event]);
    const resolved = vetoLines(lines, lineOrigins, anchoredAiLines);

    const resolvedLine = resolved.find((line) => line.text.includes("return null"));
    assert.equal(resolvedLine?.aiRatio, 0, "git veto removes the false AI flag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git veto keeps a genuine AI line that a human never touched", () => {
  const dir = initRepo();
  try {
    const file = "square.js";
    const aiContent = "export function square(x) {\n  const squared = x * x;\n  return squared;\n}\n";
    commit(dir, file, aiContent, "ai: add square");
    const event = makeEvent(file, aiContent, [
      [aiContent.indexOf("  const squared"), aiContent.indexOf("}")],
    ]);

    const headContent = aiContent + "export const sample = square(3);\n";
    commit(dir, file, headContent, "human: use square");

    const baseLabels = labelsFromRanges(aiContent, event.aiRanges);
    const propagation = propagateLabels(aiContent, baseLabels, headContent);
    const lines = rollupByLine(headContent, propagation.tokens);

    const lineOrigins = blameLineOrigins(dir, "HEAD", file);
    const anchoredAiLines = anchoredAiLinesForFile(dir, "HEAD", file, [event]);
    const resolved = vetoLines(lines, lineOrigins, anchoredAiLines);

    const aiLine = resolved.find((line) => line.text.includes("const squared"));
    assert.ok(aiLine && aiLine.aiRatio > 0, "genuine AI line must survive the veto");

    const humanLine = resolved.find((line) => line.text.includes("sample"));
    assert.equal(humanLine?.aiRatio, 0, "human-added line must stay human");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveFileProvenanceFromHistory replays across commits a file has moved past", () => {
  const dir = initRepo();
  try {
    const file = "area.js";
    const aiContent =
      "export function area(width, height) {\n  const product = width * height;\n  return product;\n}\n";
    commit(dir, file, aiContent, "ai: add area");
    const event = makeEvent(file, aiContent, [[aiContent.indexOf("  const product"), aiContent.indexOf("}")]]);

    const headContent =
      "import { log } from './log.js';\n" +
      "export function area(width, height) {\n  const product = width * height;\n  return product;\n}\n" +
      "log(area(2, 3));\n";
    commit(dir, file, headContent, "human: import and call");

    const resolved = resolveFileProvenanceFromHistory(dir, "HEAD", file, [event]);
    assert.notEqual(resolved.anchorCommit, null, "the anchored AI commit is found in history");

    const aiLine = resolved.lines.find((line) => line.text.includes("const product"));
    assert.ok(aiLine && aiLine.aiRatio > 0, "the surviving AI line stays flagged across the later commit");

    const importLine = resolved.lines.find((line) => line.text.includes("import"));
    assert.equal(importLine?.aiRatio, 0, "the human import line is not flagged");

    const callLine = resolved.lines.find((line) => line.text.includes("log(area"));
    assert.equal(callLine?.aiRatio, 0, "the human call line is not flagged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const pastTimestamp = "2020-01-01T00:00:00.000Z";

const tweakAiContent =
  "export function invoiceTotal(lines) {\n  const subtotal = sumLineAmounts(lines);\n  return applyRegionalTax(subtotal);\n}\n";

function snapshotLookup(content: string): (contentSha256: string) => string | null {
  return (contentSha256) => (contentSha256 === hashContent(content) ? content : null);
}

test("a commit tweaked after the last capture is re-anchored from the snapshot", () => {
  const dir = initRepo();
  try {
    const file = "invoice.js";
    commit(dir, file, "// invoices\n", "human: stub");
    const event = {
      ...makeEvent(file, tweakAiContent, [[0, tweakAiContent.length]]),
      ts: pastTimestamp,
    };
    const committed = tweakAiContent.replace("export function invoiceTotal(lines) {", "export function invoiceTotal(lines, region) {");
    commit(dir, file, committed, "ai work, tweaked by a human before commit");

    const withoutSnapshots = resolveFileProvenanceFromHistory(dir, "HEAD", file, [event]);
    assert.equal(withoutSnapshots.anchorCommit, null, "no exact anchor exists for the tweaked content");

    const resolved = resolveFileProvenanceFromHistory(dir, "HEAD", file, [event], {
      snapshotFor: snapshotLookup(tweakAiContent),
    });
    assert.equal(resolved.anchorKind, "reanchored");
    const aiLine = resolved.lines.find((line) => line.text.includes("sumLineAmounts"));
    assert.ok(aiLine && aiLine.aiRatio > 0, "the untouched AI line is recovered");
    const tweakedLine = resolved.lines.find((line) => line.text.includes("region"));
    assert.equal(tweakedLine?.aiRatio, 0, "the line the human changed is not claimed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a snapshot that was itself committed never re-anchors a later commit", () => {
  const dir = initRepo();
  try {
    const file = "invoice.js";
    const event = {
      ...makeEvent(file, tweakAiContent, [[0, tweakAiContent.length]]),
      ts: pastTimestamp,
    };
    const aiCommit = commit(dir, file, tweakAiContent, "ai: invoice total");
    const humanCommit = commit(dir, file, tweakAiContent + "export const currency = 'EUR';\n", "human: currency");

    const anchors = commitAnchorsForFile(dir, "HEAD", file, [event], { snapshotFor: snapshotLookup(tweakAiContent) });
    assert.equal(anchors.get(aiCommit)?.kind, "exact");
    assert.equal(anchors.has(humanCommit), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keepOnlyVerbatimAiLines drops labels on lines that are not verbatim AI lines of the snapshot", () => {
  const oldContent = "const a = compute();\nconst b = 2;\n";
  const oldLabels = tokenize(oldContent).map((token) => token.start < oldContent.indexOf("\n"));
  const newContent = "const a = compute();\nconst b = compute();\n";
  const newLabels = tokenize(newContent).map(() => true);
  const kept = keepOnlyVerbatimAiLines(oldContent, oldLabels, newContent, newLabels);
  const tokens = tokenize(newContent);
  const secondLineStart = newContent.indexOf("const b");
  assert.ok(tokens.every((token, index) => kept[index] === token.start < secondLineStart));
});
