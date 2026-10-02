import { propagateLabels } from "./propagate.js";
import { labelsFromRanges, type CharRange, type LedgerEvent } from "./ledger.js";
import {
  normalizeRanges,
  aiRangesForToolCall,
  buildEvent,
  editsForToolCall,
  commonPrefixLength,
  commonSuffixLength,
  type EditOperation,
  type ToolCall,
} from "./capture.js";

export interface CaptureSnapshot {
  readonly content: string;
  readonly fileAiRanges: readonly CharRange[];
}

export interface Replacement {
  readonly start: number;
  readonly oldText: string;
  readonly newText: string;
}

export type ChainMethod = "write" | "exact" | "propagated" | "delta-only";

export interface ChainResult {
  readonly fileAiRanges: CharRange[];
  readonly method: ChainMethod;
}

export function reverseEdits(
  content: string,
  edits: readonly EditOperation[],
): { before: string; steps: Replacement[] } | null {
  let current = content;
  const steps: Replacement[] = [];
  for (let editIndex = edits.length - 1; editIndex >= 0; editIndex--) {
    const edit = edits[editIndex]!;
    if (edit.replaceAll || edit.newString === "") return null;
    const first = current.indexOf(edit.newString);
    if (first === -1 || current.indexOf(edit.newString, first + 1) !== -1) return null;
    current = current.slice(0, first) + edit.oldString + current.slice(first + edit.newString.length);
    steps.unshift({ start: first, oldText: edit.oldString, newText: edit.newString });
  }
  return { before: current, steps };
}

export function mapRangesThroughReplacement(
  ranges: readonly CharRange[],
  replacement: Replacement,
): CharRange[] {
  const { start, oldText, newText } = replacement;
  const prefix = commonPrefixLength(oldText, newText);
  const suffix = commonSuffixLength(oldText, newText, prefix);
  const keptHeadEnd = start + prefix;
  const keptTailStart = start + oldText.length - suffix;
  const shift = newText.length - oldText.length;

  const mapped: CharRange[] = [];
  for (const [rangeStart, rangeEnd] of ranges) {
    const headEnd = Math.min(rangeEnd, keptHeadEnd);
    if (headEnd > rangeStart) mapped.push([rangeStart, headEnd]);
    const tailStart = Math.max(rangeStart, keptTailStart);
    if (rangeEnd > tailStart) mapped.push([tailStart + shift, rangeEnd + shift]);
  }
  return mapped;
}

export function propagateRanges(
  previousContent: string,
  previousRanges: readonly CharRange[],
  content: string,
): CharRange[] {
  const labels = labelsFromRanges(previousContent, previousRanges);
  const propagation = propagateLabels(previousContent, labels, content, { anchorStrength: "distinctive" });
  return propagation.tokens.filter((token) => token.ai).map((token): CharRange => [token.start, token.end]);
}

export function chainFileAiRanges(params: {
  readonly call: ToolCall;
  readonly content: string;
  readonly deltaRanges: readonly CharRange[];
  readonly previous: CaptureSnapshot | null;
}): ChainResult {
  const { call, content, deltaRanges, previous } = params;
  if (call.toolName === "Write") return { fileAiRanges: normalizeRanges(deltaRanges), method: "write" };
  if (previous === null) return { fileAiRanges: normalizeRanges(deltaRanges), method: "delta-only" };

  const reversed = reverseEdits(content, editsForToolCall(call));
  if (reversed !== null && reversed.before === previous.content) {
    let carried: CharRange[] = [...previous.fileAiRanges];
    for (const step of reversed.steps) carried = mapRangesThroughReplacement(carried, step);
    return { fileAiRanges: normalizeRanges([...carried, ...deltaRanges]), method: "exact" };
  }

  const propagated = propagateRanges(previous.content, previous.fileAiRanges, content);
  return { fileAiRanges: normalizeRanges([...propagated, ...deltaRanges]), method: "propagated" };
}

export function buildChainedEvent(params: {
  readonly call: ToolCall;
  readonly content: string;
  readonly file: string;
  readonly tool: string;
  readonly model: string | null;
  readonly previous: CaptureSnapshot | null;
  readonly id?: string;
  readonly ts?: string;
}): { event: LedgerEvent; method: ChainMethod } | null {
  const deltaRanges = aiRangesForToolCall(params.call, params.content);
  if (deltaRanges === null || deltaRanges.length === 0) return null;
  const chain = chainFileAiRanges({
    call: params.call,
    content: params.content,
    deltaRanges,
    previous: params.previous,
  });
  const event = buildEvent({
    tool: params.tool,
    model: params.model,
    file: params.file,
    content: params.content,
    aiRanges: deltaRanges,
    fileAiRanges: chain.fileAiRanges,
    ...(params.id === undefined ? {} : { id: params.id }),
    ...(params.ts === undefined ? {} : { ts: params.ts }),
  });
  return { event, method: chain.method };
}
