import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isHistoryCommand, aiRangesForBashChange, diffLines } from "./bash-capture.js";
import { parseLedger, effectiveAiRanges, type CharRange } from "./ledger.js";

const hookScript = join(dirname(fileURLToPath(import.meta.url)), "capture-hook.ts");

function claimedTexts(content: string, ranges: readonly CharRange[]): string[] {
  return ranges.map(([start, end]) => content.slice(start, end));
}

test("history commands are recognized and skipped", () => {
  assert.ok(isHistoryCommand("git pull --rebase"));
  assert.ok(isHistoryCommand("cd app && git -C ../lib merge origin/main"));
  assert.ok(isHistoryCommand("git stash && python3 fix.py && git stash pop"));
  assert.ok(isHistoryCommand("gh pr checkout 42"));
  assert.ok(!isHistoryCommand("git status && git diff"));
  assert.ok(!isHistoryCommand("git commit -m 'checkout page'"));
});

test("a heredoc-written file is claimed line by line", () => {
  const after = "export function double(value) {\n  return value * 2;\n}\n";
  const command = `cat > double.js <<'EOF'\n${after}EOF`;
  assert.deepEqual(claimedTexts(after, aiRangesForBashChange("", after, command)), [
    "export function double(value) {",
    "  return value * 2;",
    "}",
  ]);
});

test("output the command did not spell out stays unknown", () => {
  const after = "export const value1 = 1;\nexport const value2 = 4;\n";
  const command = "node generate.js > generated.js";
  assert.deepEqual(aiRangesForBashChange("", after, command), []);
});

test("lines moved by an AI command keep their original author", () => {
  const humanFunction = "function human() {\n  return computeHumanThing();\n}\n";
  const before = humanFunction + "const marker = 1;\n";
  const after = "const marker = 1;\n" + humanFunction;
  const command = `python3 -c 'move(${JSON.stringify(humanFunction)})'`;
  assert.deepEqual(aiRangesForBashChange(before, after, command), []);
});

test("a short line alone is never claimed, even if the command contains it", () => {
  const before = "function f() {\n  return 1;\n";
  const after = before + "}\n";
  assert.deepEqual(aiRangesForBashChange(before, after, "echo '}' >> f.js"), []);
});

test("a substitution claims only the changed fragment of the line", () => {
  const before = "  return JSON.parse(trimmed);\n";
  const after = "  return JSON.parse(trimmed, reviveDates);\n";
  const command = "perl -pi -e 's/JSON.parse\\(trimmed\\)/JSON.parse(trimmed, reviveDates)/' sample.js";
  assert.deepEqual(claimedTexts(after, aiRangesForBashChange(before, after, command)), [", reviveDates"]);
});

test("an insertion after a closing brace slides below the existing brace", () => {
  const before = ["function a() {", "}", ""];
  const after = ["function a() {", "}", "", "function b() {", "}", ""];
  const hunks = diffLines(before, after);
  assert.deepEqual(hunks, [{ removed: [], added: [3, 4, 5] }]);
});

function runHook(payload: unknown): void {
  execFileSync(process.execPath, ["--import", "tsx", hookScript], { input: JSON.stringify(payload), encoding: "utf8" });
}

test("the hook captures a Bash command between its pre and post snapshots", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "provably-bash-hook-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: repoDir });
    writeFileSync(join(repoDir, ".gitignore"), ".ai-provenance/\n");
    writeFileSync(join(repoDir, "human.js"), "export const human = 1;\n");

    const command = `cat > tool.js <<'EOF'\nexport function addTax(amount) {\n  return amount * 1.2;\n}\nEOF`;
    const payload = { tool_name: "Bash", cwd: repoDir, tool_use_id: "toolu_test", tool_input: { command } };
    runHook({ ...payload, hook_event_name: "PreToolUse" });
    execSync(command, { cwd: repoDir, shell: "/bin/bash" });
    runHook({ ...payload, hook_event_name: "PostToolUse" });

    const events = parseLedger(readFileSync(join(repoDir, ".ai-provenance", "ledger.jsonl"), "utf8"));
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(event.file, "tool.js");
    const content = readFileSync(join(repoDir, "tool.js"), "utf8");
    assert.deepEqual(claimedTexts(content, effectiveAiRanges(event)), [
      "export function addTax(amount) {",
      "  return amount * 1.2;",
      "}",
    ]);
    assert.deepEqual(readdirSync(join(repoDir, ".ai-provenance", "pending")), []);
    assert.ok(existsSync(join(repoDir, ".ai-provenance", "blobs", event.contentSha256)));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
