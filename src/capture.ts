import { randomUUID } from "node:crypto";
import { hashContent, type CharRange, type LedgerEvent } from "./ledger.js";

export interface EditOperation {
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll: boolean;
}

export interface ToolCall {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
}

export function aiRangesForWrite(content: string): CharRange[] {
  if (content.length === 0) return [];
  return [[0, content.length]];
}

export function aiRangesForEdit(content: string, edit: EditOperation): CharRange[] {
  const indices = occurrences(content, edit.newString);
  if (indices.length === 0) return [];
  if (!edit.replaceAll && indices.length !== 1) return [];
  const prefix = commonPrefixLength(edit.oldString, edit.newString);
  const suffix = commonSuffixLength(edit.oldString, edit.newString, prefix);
  const innerStart = prefix;
  const innerEnd = edit.newString.length - suffix;
  if (innerEnd <= innerStart) return [];
  return indices.map((index): CharRange => [index + innerStart, index + innerEnd]);
}

export function aiRangesForMultiEdit(content: string, edits: readonly EditOperation[]): CharRange[] {
  const ranges: CharRange[] = [];
  for (const edit of edits) ranges.push(...aiRangesForEdit(content, edit));
  return normalizeRanges(ranges);
}

export function aiRangesForToolCall(call: ToolCall, content: string): CharRange[] | null {
  switch (call.toolName) {
    case "Write":
      return normalizeRanges(aiRangesForWrite(content));
    case "Edit":
      return normalizeRanges(aiRangesForEdit(content, readEdit(call.toolInput)));
    case "MultiEdit":
      return aiRangesForMultiEdit(content, readEdits(call.toolInput));
    default:
      return null;
  }
}

export function buildEvent(params: {
  tool: string;
  model: string | null;
  file: string;
  content: string;
  aiRanges: readonly CharRange[];
  fileAiRanges?: readonly CharRange[];
  id?: string;
  ts?: string;
}): LedgerEvent {
  const event: LedgerEvent = {
    v: 1,
    id: params.id ?? randomUUID(),
    ts: params.ts ?? new Date().toISOString(),
    tool: params.tool,
    model: params.model,
    file: params.file,
    contentSha256: hashContent(params.content),
    aiRanges: params.aiRanges,
  };
  return params.fileAiRanges === undefined ? event : { ...event, fileAiRanges: params.fileAiRanges };
}

export function normalizeRanges(ranges: readonly CharRange[]): CharRange[] {
  const sorted = ranges
    .filter((range) => range[1] > range[0])
    .slice()
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: CharRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

function readEdit(input: Record<string, unknown>): EditOperation {
  return {
    oldString: typeof input.old_string === "string" ? input.old_string : "",
    newString: typeof input.new_string === "string" ? input.new_string : "",
    replaceAll: input.replace_all === true,
  };
}

export function editsForToolCall(call: ToolCall): EditOperation[] {
  if (call.toolName === "MultiEdit") return readEdits(call.toolInput);
  if (call.toolName === "Edit") return [readEdit(call.toolInput)];
  return [];
}

function readEdits(input: Record<string, unknown>): EditOperation[] {
  const edits = Array.isArray(input.edits) ? input.edits : [];
  return edits.map((edit) => readEdit((edit ?? {}) as Record<string, unknown>));
}

export function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let count = 0;
  while (count < max && left[count] === right[count]) count++;
  return count;
}

export function commonSuffixLength(left: string, right: string, prefix: number): number {
  const max = Math.min(left.length, right.length) - prefix;
  let count = 0;
  while (count < max && left[left.length - 1 - count] === right[right.length - 1 - count]) count++;
  return count;
}

function occurrences(haystack: string, needle: string): number[] {
  if (needle === "") return [];
  const indices: number[] = [];
  let from = 0;
  while (true) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    indices.push(index);
    from = index + needle.length;
  }
  return indices;
}
