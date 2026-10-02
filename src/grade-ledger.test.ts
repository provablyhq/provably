import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.js";
import { hashContent, type LedgerEvent } from "./ledger.js";
import { discoverAnchors, gradeLedger, survivalRecall } from "./grade-ledger.js";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "provably-ledger-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): void {
  writeFileSync(join(dir, file), content);
  git(dir, ["add", file]);
  git(dir, ["commit", "-q", "-m", message]);
}

function makeEvent(file: string, content: string, aiRanges: [number, number][]): LedgerEvent {
  return {
    v: 1,
    id: `event-${hashContent(content).slice(0, 8)}`,
    ts: "2026-10-02T00:00:00.000Z",
    tool: "claude-code",
    model: "claude-opus-4-8",
    file,
    contentSha256: hashContent(content),
    aiRanges,
  };
}

test("gradeLedger measures survival recall of earlier AI lines at a later committed state", () => {
  const dir = initRepo();
  try {
    const file = "area.js";

    const first = "export function area(w, h) {\n  return w * h;\n}\n";
    commit(dir, file, first, "ai: add area");
    const firstEvent = makeEvent(file, first, [[0, first.length]]);

    const human = "const DEFAULT = 1;\n" + first;
    commit(dir, file, human, "human: add default");

    const second =
      "const DEFAULT = 1;\n" +
      "export function area(w, h) {\n  return w * h;\n}\n" +
      "export function perimeter(w, h) {\n  return 2 * (w + h);\n}\n";
    commit(dir, file, second, "ai: add perimeter");
    const secondEvent = makeEvent(file, second, [[second.indexOf("export function area"), second.length]]);

    const events = [firstEvent, secondEvent];

    const anchors = discoverAnchors(dir, "HEAD", file, events);
    assert.equal(anchors.length, 2, "both AI commits are recognized as anchored states");

    const result = gradeLedger(dir, "HEAD", events);
    assert.equal(result.gradablePairs, 1);

    assert.ok(result.overall.survivedAiLines > 0, "the earlier AI lines still exist at the later state");
    assert.equal(
      result.overall.recalledAiLines,
      result.overall.survivedAiLines,
      "the engine still flags every surviving earlier AI line",
    );
    assert.equal(survivalRecall(result.overall), 1, "survival recall is complete for the carried AI function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gradeLedger reports no pairs when a file has a single anchored state", () => {
  const dir = initRepo();
  try {
    const file = "solo.js";
    const content = "export const value = 1;\n";
    commit(dir, file, content, "ai: add value");
    const events = [makeEvent(file, content, [[0, content.length]])];

    const result = gradeLedger(dir, "HEAD", events);
    assert.equal(result.gradablePairs, 0);
    assert.equal(result.files[0]?.anchorCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
