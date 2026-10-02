import { hashContent, labelsFromRanges, effectiveAiRanges, type LedgerEvent } from "./ledger.js";
import { fileContentAtRev, commitTimesTouchingFile, blameLineOrigins, type LineOrigin } from "./git.js";
import { tokenize } from "./tokenize.js";
import { propagateLabels } from "./propagate.js";
import { rollupByLine, type LineProvenance } from "./lines.js";

export interface ResolveOptions {
  readonly snapshotFor?: (contentSha256: string) => string | null;
}

export interface CommitAnchor {
  readonly content: string;
  readonly labels: readonly boolean[];
  readonly aiLines: ReadonlySet<number>;
  readonly kind: "exact" | "reanchored";
  readonly eventId: string;
}

export function commitAnchorsForFile(
  repoDir: string,
  rev: string,
  file: string,
  events: readonly LedgerEvent[],
  options: ResolveOptions = {},
): Map<string, CommitAnchor> {
  const fileEvents = events
    .filter((event) => event.file === file)
    .slice()
    .sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
  const eventByHash = new Map<string, LedgerEvent>();
  for (const event of fileEvents) eventByHash.set(event.contentSha256, event);

  const commits = commitTimesTouchingFile(repoDir, rev, file).reverse();
  const contentByCommit = new Map<string, string>();
  for (const { commit } of commits) {
    try {
      contentByCommit.set(commit, fileContentAtRev(repoDir, commit, file));
    } catch {
      continue;
    }
  }
  const committedHashes = new Set([...contentByCommit.values()].map(hashContent));

  const anchors = new Map<string, CommitAnchor>();
  const usedEventIds = new Set<string>();
  for (const { commit, authorTime } of commits) {
    const content = contentByCommit.get(commit);
    if (content === undefined) continue;

    const exact = eventByHash.get(hashContent(content));
    if (exact) {
      anchors.set(commit, buildAnchor(content, labelsFromRanges(content, effectiveAiRanges(exact)), "exact", exact.id));
      continue;
    }

    const reanchored = reanchorFromSnapshot(content, authorTime, fileEvents, committedHashes, usedEventIds, options);
    if (reanchored) anchors.set(commit, reanchored);
  }
  return anchors;
}

function reanchorFromSnapshot(
  content: string,
  authorTime: number,
  fileEvents: readonly LedgerEvent[],
  committedHashes: ReadonlySet<string>,
  usedEventIds: Set<string>,
  options: ResolveOptions,
): CommitAnchor | null {
  if (options.snapshotFor === undefined) return null;
  const candidate = [...fileEvents].reverse().find((event) => Math.floor(Date.parse(event.ts) / 1000) <= authorTime);
  if (candidate === undefined) return null;
  if (committedHashes.has(candidate.contentSha256) || usedEventIds.has(candidate.id)) return null;

  const snapshot = options.snapshotFor(candidate.contentSha256);
  if (snapshot === null || hashContent(snapshot) !== candidate.contentSha256) return null;

  const snapshotLabels = labelsFromRanges(snapshot, effectiveAiRanges(candidate));
  const propagated = propagateLabels(snapshot, snapshotLabels, content, { anchorStrength: "distinctive" }).labels;
  const labels = keepOnlyVerbatimAiLines(snapshot, snapshotLabels, content, propagated);
  if (!labels.some(Boolean)) return null;
  usedEventIds.add(candidate.id);
  return buildAnchor(content, labels, "reanchored", candidate.id);
}

export function keepOnlyVerbatimAiLines(
  oldContent: string,
  oldLabels: readonly boolean[],
  newContent: string,
  newLabels: readonly boolean[],
): boolean[] {
  const oldTokens = tokenize(oldContent).map((token, index) => ({ ...token, ai: oldLabels[index]! }));
  const oldAiLineTexts = new Set(
    rollupByLine(oldContent, oldTokens)
      .filter((line) => line.aiRatio > 0)
      .map((line) => line.text),
  );
  const newTokens = tokenize(newContent);
  const newLineTexts = newContent.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const text of newLineTexts) {
    lineStarts.push(offset);
    offset += text.length + 1;
  }
  let lineIndex = 0;
  return newTokens.map((token, tokenIndex) => {
    while (lineIndex + 1 < lineStarts.length && lineStarts[lineIndex + 1]! <= token.start) lineIndex++;
    return newLabels[tokenIndex]! && oldAiLineTexts.has(newLineTexts[lineIndex]!);
  });
}

function buildAnchor(
  content: string,
  labels: readonly boolean[],
  kind: CommitAnchor["kind"],
  eventId: string,
): CommitAnchor {
  const tokens = tokenize(content).map((token, index) => ({ ...token, ai: labels[index]! }));
  const aiLines = new Set<number>();
  for (const line of rollupByLine(content, tokens)) {
    if (line.aiRatio > 0) aiLines.add(line.lineNumber);
  }
  return { content, labels, aiLines, kind, eventId };
}

export function anchoredAiLinesForFile(
  repoDir: string,
  rev: string,
  file: string,
  events: readonly LedgerEvent[],
  options: ResolveOptions = {},
): Map<string, ReadonlySet<number>> {
  const aiLinesByCommit = new Map<string, ReadonlySet<number>>();
  for (const [commit, anchor] of commitAnchorsForFile(repoDir, rev, file, events, options)) {
    aiLinesByCommit.set(commit, anchor.aiLines);
  }
  return aiLinesByCommit;
}

export interface HistoryProvenance {
  readonly lines: LineProvenance[];
  readonly anchorCommit: string | null;
  readonly anchorKind: CommitAnchor["kind"] | null;
  readonly eventIdByLine: ReadonlyMap<number, string>;
}

export function resolveFileProvenanceFromHistory(
  repoDir: string,
  rev: string,
  file: string,
  events: readonly LedgerEvent[],
  options: ResolveOptions = {},
): HistoryProvenance {
  const anchors = commitAnchorsForFile(repoDir, rev, file, events, options);
  const newestFirst = commitTimesTouchingFile(repoDir, rev, file).map(({ commit }) => commit);
  const baseCommit = newestFirst.find((commit) => anchors.has(commit));
  if (baseCommit === undefined) return { lines: [], anchorCommit: null, anchorKind: null, eventIdByLine: new Map() };
  const base = anchors.get(baseCommit)!;

  const headContent = fileContentAtRev(repoDir, rev, file);
  const propagation = propagateLabels(base.content, base.labels, headContent);
  const predictedLines = rollupByLine(headContent, propagation.tokens);

  const aiLinesByCommit = new Map<string, ReadonlySet<number>>();
  for (const [commit, anchor] of anchors) aiLinesByCommit.set(commit, anchor.aiLines);
  const lineOrigins = blameLineOrigins(repoDir, rev, file);
  const resolved = vetoLines(predictedLines, lineOrigins, aiLinesByCommit);
  const eventIdByLine = new Map<number, string>();
  resolved.forEach((line, lineIndex) => {
    if (line.aiRatio === 0) return;
    const origin = lineOrigins[lineIndex];
    const originAnchor = origin === undefined ? undefined : anchors.get(origin.commit);
    if (originAnchor !== undefined) eventIdByLine.set(line.lineNumber, originAnchor.eventId);
  });
  return { lines: resolved, anchorCommit: baseCommit, anchorKind: base.kind, eventIdByLine };
}

export function vetoLines(
  lines: readonly LineProvenance[],
  lineOrigins: readonly LineOrigin[],
  anchoredAiLines: ReadonlyMap<string, ReadonlySet<number>>,
): LineProvenance[] {
  return lines.map((line, lineIndex) => {
    if (line.aiTokenCount === 0) return line;
    const origin = lineOrigins[lineIndex];
    const aiLines = origin ? anchoredAiLines.get(origin.commit) : undefined;
    const confirmed = origin !== undefined && aiLines !== undefined && aiLines.has(origin.originalLine);
    return confirmed ? line : { ...line, aiTokenCount: 0, aiRatio: 0 };
  });
}
