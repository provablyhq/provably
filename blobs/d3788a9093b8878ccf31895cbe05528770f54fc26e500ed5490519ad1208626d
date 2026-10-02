import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aiRangesForWrite,
  aiRangesForEdit,
  aiRangesForMultiEdit,
  aiRangesForToolCall,
  normalizeRanges,
} from "./capture.js";
import { parseLedger, labelsFromRanges, hashContent } from "./ledger.js";
import { tokenize } from "./tokenize.js";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(sourceDirectory);
const hookScript = join(sourceDirectory, "capture-hook.ts");

test("write captures the whole file as AI", () => {
  const content = "const value = 1;\n";
  assert.deepEqual(aiRangesForWrite(content), [[0, content.length]]);
  assert.deepEqual(aiRangesForWrite(""), []);
});

test("edit captures only the changed middle, not shared context", () => {
  const content = "function pick() {\n  return chosen;\n}\n";
  const ranges = aiRangesForEdit(content, {
    oldString: "return value;",
    newString: "return chosen;",
    replaceAll: false,
  });
  const start = content.indexOf("chosen");
  assert.deepEqual(ranges, [[start, start + "chosen".length]]);

  const labels = labelsFromRanges(content, ranges);
  const tokens = tokenize(content);
  const aiTokens = tokens.filter((_, index) => labels[index]).map((token) => token.text);
  assert.deepEqual(aiTokens, ["chosen"]);
});

test("edit fails toward unknown when the new string is ambiguous", () => {
  const content = "log();\nlog();\n";
  const ranges = aiRangesForEdit(content, { oldString: "noop();", newString: "log();", replaceAll: false });
  assert.deepEqual(ranges, []);
});

test("replace-all edit captures the changed text at every occurrence", () => {
  const content = "a;\na;\n";
  const ranges = aiRangesForEdit(content, { oldString: "b;", newString: "a;", replaceAll: true });
  assert.deepEqual(ranges, [
    [0, 1],
    [3, 4],
  ]);
});

test("multi-edit merges overlapping captured ranges", () => {
  const content = "abcdef";
  const ranges = aiRangesForMultiEdit(content, [
    { oldString: "x", newString: "abc", replaceAll: false },
    { oldString: "y", newString: "cde", replaceAll: false },
  ]);
  assert.deepEqual(ranges, [[0, 5]]);
});

test("normalizeRanges sorts, drops empties, and merges", () => {
  assert.deepEqual(
    normalizeRanges([
      [10, 12],
      [0, 3],
      [5, 5],
      [2, 6],
    ]),
    [
      [0, 6],
      [10, 12],
    ],
  );
});

test("unknown tool yields no ranges", () => {
  assert.equal(aiRangesForToolCall({ toolName: "Bash", toolInput: {} }, "whatever"), null);
});

function runHook(payload: unknown): void {
  execFileSync(process.execPath, ["--import", "tsx", hookScript], {
    cwd: projectRoot,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

test("the hook writes a replayable ledger that the propagation path trusts", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "provably-capture-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: repoDir });

    const filePath = join(repoDir, "sample.js");
    const writtenContent = "export function add(a, b) {\n  return a + b;\n}\n";
    writeFileSync(filePath, writtenContent);
    runHook({
      tool_name: "Write",
      cwd: repoDir,
      tool_input: { file_path: filePath, content: writtenContent },
    });

    const editedContent = "export function add(a, b) {\n  return a + b;\n}\nexport const sample = add(1, 2);\n";
    writeFileSync(filePath, editedContent);
    runHook({
      tool_name: "Edit",
      cwd: repoDir,
      tool_input: {
        file_path: filePath,
        old_string: "}\n",
        new_string: "}\nexport const sample = add(1, 2);\n",
      },
    });

    const ledgerPath = join(repoDir, ".ai-provenance", "ledger.jsonl");
    const events = parseLedger(readFileSync(ledgerPath, "utf8"));
    assert.equal(events.length, 2);

    const writeEvent = events[0]!;
    assert.equal(writeEvent.tool, "claude-code");
    assert.equal(writeEvent.file, "sample.js");
    assert.equal(writeEvent.contentSha256, hashContent(writtenContent));
    assert.deepEqual(writeEvent.aiRanges, [[0, writtenContent.length]]);

    const editEvent = events[1]!;
    assert.equal(editEvent.contentSha256, hashContent(editedContent));
    const labels = labelsFromRanges(editedContent, editEvent.aiRanges);
    const tokens = tokenize(editedContent);
    const aiLineHasSample = tokens.some((token, index) => labels[index] && token.text === "sample");
    const addSignatureIsHuman = tokens.every(
      (token, index) => !(labels[index] && token.start < editedContent.indexOf("export const sample")),
    );
    assert.ok(aiLineHasSample, "the appended AI line is captured");
    assert.ok(addSignatureIsHuman, "the edit does not claim text it did not write");

    assert.deepEqual(editEvent.fileAiRanges, [[0, editedContent.length]], "the chained ranges keep the earlier Write");
    const snapshot = readFileSync(join(repoDir, ".ai-provenance", "blobs", editEvent.contentSha256), "utf8");
    assert.equal(snapshot, editedContent);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("the hook records the model from the session transcript", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "provably-model-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: repoDir });

    const transcriptPath = join(repoDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: "user", message: { role: "user" } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", model: "claude-opus-4-8" } }),
      ].join("\n") + "\n",
    );

    const filePath = join(repoDir, "value.js");
    const content = "export const value = 1;\n";
    writeFileSync(filePath, content);
    runHook({
      tool_name: "Write",
      cwd: repoDir,
      transcript_path: transcriptPath,
      tool_input: { file_path: filePath, content },
    });

    const events = parseLedger(readFileSync(join(repoDir, ".ai-provenance", "ledger.jsonl"), "utf8"));
    assert.equal(events[0]?.model, "claude-opus-4-8");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
