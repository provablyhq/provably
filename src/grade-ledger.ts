import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileContentAtRev, commitsTouchingFile } from "./git.js";
import { parseLedger, hashContent, labelsFromRanges, effectiveAiRanges, type LedgerEvent } from "./ledger.js";
import { tokenize } from "./tokenize.js";
import { rollupByLine, type LineProvenance } from "./lines.js";
import { resolveFileProvenanceFromHistory } from "./resolve.js";

const AI_LINE_THRESHOLD = 0.5;

export interface Anchor {
  readonly commit: string;
  readonly event: LedgerEvent;
}

export interface SurvivalTotals {
  survivedAiLines: number;
  recalledAiLines: number;
}

export interface LedgerFileResult {
  readonly file: string;
  readonly anchorCount: number;
  readonly pairCount: number;
  readonly totals: SurvivalTotals;
}

export interface LedgerGradeResult {
  readonly files: LedgerFileResult[];
  readonly overall: SurvivalTotals;
  readonly gradablePairs: number;
}

export function repoRoot(startDir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: startDir, encoding: "utf8" }).trim();
  } catch {
    return startDir;
  }
}

export function loadLedger(repoDir: string, ledgerPath?: string): LedgerEvent[] {
  const path = ledgerPath ?? join(repoDir, ".ai-provenance", "ledger.jsonl");
  return parseLedger(readFileSync(path, "utf8"));
}

export function discoverAnchors(
  repoDir: string,
  rev: string,
  file: string,
  events: readonly LedgerEvent[],
): Anchor[] {
  const eventByHash = new Map<string, LedgerEvent>();
  for (const event of events) {
    if (event.file === file) eventByHash.set(event.contentSha256, event);
  }
  if (eventByHash.size === 0) return [];

  const anchors: Anchor[] = [];
  for (const commit of commitsTouchingFile(repoDir, rev, file)) {
    let content: string;
    try {
      content = fileContentAtRev(repoDir, commit, file);
    } catch {
      continue;
    }
    const event = eventByHash.get(hashContent(content));
    if (event) anchors.push({ commit, event });
  }
  return anchors.reverse();
}

export function gradeLedgerFile(
  repoDir: string,
  rev: string,
  file: string,
  events: readonly LedgerEvent[],
): LedgerFileResult {
  const anchors = discoverAnchors(repoDir, rev, file, events);
  const totals: SurvivalTotals = { survivedAiLines: 0, recalledAiLines: 0 };
  let pairCount = 0;

  for (let index = 0; index + 1 < anchors.length; index++) {
    const earlier = anchors[index]!;
    const later = anchors[index + 1]!;

    const predicted = resolveFileProvenanceFromHistory(repoDir, later.commit, file, [earlier.event]);
    if (predicted.anchorCommit === null) continue;

    const earlierContent = fileContentAtRev(repoDir, earlier.commit, file);
    const earlierAiLineTexts = aiLineTexts(labeledLines(earlierContent, effectiveAiRanges(earlier.event)));
    const truthCounts = toMultiset(earlierAiLineTexts);

    const laterContent = fileContentAtRev(repoDir, later.commit, file);
    const laterLineCounts = toMultiset(nonEmptyLineTexts(laterContent));
    const predictedCounts = toMultiset(aiLineTexts(predicted.lines));

    for (const [text, truthCount] of truthCounts) {
      const survived = Math.min(truthCount, laterLineCounts.get(text) ?? 0);
      if (survived === 0) continue;
      totals.survivedAiLines += survived;
      totals.recalledAiLines += Math.min(survived, predictedCounts.get(text) ?? 0);
    }
    pairCount++;
  }

  return { file, anchorCount: anchors.length, pairCount, totals };
}

export function gradeLedger(repoDir: string, rev: string, events: readonly LedgerEvent[]): LedgerGradeResult {
  const files = [...new Set(events.map((event) => event.file))].sort();
  const overall: SurvivalTotals = { survivedAiLines: 0, recalledAiLines: 0 };
  const results: LedgerFileResult[] = [];
  let gradablePairs = 0;

  for (const file of files) {
    const result = gradeLedgerFile(repoDir, rev, file, events);
    results.push(result);
    overall.survivedAiLines += result.totals.survivedAiLines;
    overall.recalledAiLines += result.totals.recalledAiLines;
    gradablePairs += result.pairCount;
  }

  return { files: results, overall, gradablePairs };
}

export function survivalRecall(totals: SurvivalTotals): number {
  return totals.survivedAiLines === 0 ? 1 : totals.recalledAiLines / totals.survivedAiLines;
}

function labeledLines(content: string, aiRanges: readonly (readonly [number, number])[]): LineProvenance[] {
  const labels = labelsFromRanges(content, aiRanges);
  const tokens = tokenize(content).map((token, index) => ({ ...token, ai: labels[index]! }));
  return rollupByLine(content, tokens);
}

function aiLineTexts(lines: readonly LineProvenance[]): string[] {
  return lines
    .filter((line) => line.totalTokenCount > 0 && line.aiRatio >= AI_LINE_THRESHOLD)
    .map((line) => line.text.trim());
}

function nonEmptyLineTexts(content: string): string[] {
  return content
    .split("\n")
    .map((text) => text.trim())
    .filter((text) => text !== "");
}

function toMultiset(items: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}
