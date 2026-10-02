import { createHash } from "node:crypto";
import { tokenize } from "./tokenize.js";

export type CharRange = readonly [start: number, end: number];

export interface LedgerEvent {
  readonly v: 1;
  readonly id: string;
  readonly ts: string;
  readonly tool: string;
  readonly model: string | null;
  readonly file: string;
  readonly contentSha256: string;
  readonly aiRanges: readonly CharRange[];
  readonly fileAiRanges?: readonly CharRange[];
}

export function effectiveAiRanges(event: LedgerEvent): readonly CharRange[] {
  return event.fileAiRanges ?? event.aiRanges;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function parseLedger(jsonl: string): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  const lines = jsonl.split("\n");
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber]!.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new Error(`Invalid JSON on ledger line ${lineNumber + 1}`, { cause });
    }
    events.push(validateEvent(parsed, lineNumber + 1));
  }
  return events;
}

export function serializeEvent(event: LedgerEvent): string {
  return JSON.stringify(event);
}

function validateEvent(value: unknown, lineNumber: number): LedgerEvent {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Ledger line ${lineNumber} is not an object`);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== 1) {
    throw new Error(`Ledger line ${lineNumber}: unsupported schema version ${String(candidate.v)}`);
  }
  for (const field of ["id", "ts", "tool", "file", "contentSha256"] as const) {
    if (typeof candidate[field] !== "string") {
      throw new Error(`Ledger line ${lineNumber}: field "${field}" must be a string`);
    }
  }
  if (candidate.model !== null && typeof candidate.model !== "string") {
    throw new Error(`Ledger line ${lineNumber}: field "model" must be a string or null`);
  }
  if (!Array.isArray(candidate.aiRanges)) {
    throw new Error(`Ledger line ${lineNumber}: field "aiRanges" must be an array`);
  }
  const aiRanges = candidate.aiRanges.map((range, rangeIndex) => validateRange(range, lineNumber, rangeIndex));
  const event: LedgerEvent = {
    v: 1,
    id: candidate.id as string,
    ts: candidate.ts as string,
    tool: candidate.tool as string,
    model: (candidate.model ?? null) as string | null,
    file: candidate.file as string,
    contentSha256: candidate.contentSha256 as string,
    aiRanges,
  };
  if (candidate.fileAiRanges === undefined) return event;
  if (!Array.isArray(candidate.fileAiRanges)) {
    throw new Error(`Ledger line ${lineNumber}: field "fileAiRanges" must be an array when present`);
  }
  const fileAiRanges = candidate.fileAiRanges.map((range, rangeIndex) =>
    validateRange(range, lineNumber, rangeIndex, "fileAiRanges"),
  );
  return { ...event, fileAiRanges };
}

function validateRange(value: unknown, lineNumber: number, rangeIndex: number, field = "aiRanges"): CharRange {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    value[0] < 0 ||
    value[1] < value[0]
  ) {
    throw new Error(`Ledger line ${lineNumber}: ${field}[${rangeIndex}] must be [start, end] with 0 <= start <= end`);
  }
  return [value[0], value[1]];
}

export function labelsFromRanges(content: string, aiRanges: readonly CharRange[]): boolean[] {
  const tokens = tokenize(content);
  return tokens.map((token) => aiRanges.some((range) => token.start < range[1] && token.end > range[0]));
}
