import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git.js";
import { HOOK_BLOCK_START, hasCaptureHook, prePushHookPath } from "./init.js";
import { LEDGER_FILE, ledgerRefFor, loadProvenance } from "./ledger-sync.js";
import { LEDGER_DIRECTORY } from "./snapshot-store.js";

function claudeHooksInstalled(repoRoot: string): boolean {
  for (const file of ["settings.json", "settings.local.json"]) {
    const path = join(repoRoot, ".claude", file);
    if (!existsSync(path)) continue;
    try {
      const settings = JSON.parse(readFileSync(path, "utf8")) as { hooks?: Record<string, unknown[]> };
      if (hasCaptureHook(settings.hooks?.PostToolUse as never)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function mark(ok: boolean): string {
  return ok ? "ok     " : "missing";
}

export function runStatus(argv: readonly string[]): number {
  if (argv.length > 0) {
    process.stderr.write("usage: provably status\n");
    return 2;
  }
  let repoRoot: string;
  try {
    repoRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    process.stderr.write("provably status must run inside a git repository\n");
    return 2;
  }

  const claudeHooks = claudeHooksInstalled(repoRoot);
  const hookPath = prePushHookPath(repoRoot);
  const prePush = existsSync(hookPath) && readFileSync(hookPath, "utf8").includes(HOOK_BLOCK_START);
  const localLedgerPath = join(repoRoot, LEDGER_DIRECTORY, LEDGER_FILE);
  const provenance = loadProvenance(repoRoot);
  const lastEvent = [...provenance.events].sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))[0];
  let sharedCommit: string | null = null;
  try {
    sharedCommit = git(repoRoot, ["rev-parse", "--verify", "--quiet", ledgerRefFor(repoRoot)]).trim() || null;
  } catch {
    sharedCommit = null;
  }

  const lines = [
    `provably in ${repoRoot}`,
    "",
    `  ${mark(claudeHooks)}  Claude Code capture hooks`,
    `  ${mark(prePush)}  git pre-push hook (shares provenance on push)`,
    existsSync(localLedgerPath)
      ? `  ok       local ledger: ${provenance.localEventCount} AI edit(s) recorded${lastEvent ? `, latest ${lastEvent.ts} in ${lastEvent.file}` : ""}`
      : "  none yet local ledger (starts with Claude Code's first edit in this repository)",
    `  ${sharedCommit === null ? "not yet" : "ok     "}  shared ledger for this clone${sharedCommit === null ? " (created on your next git push)" : ` at ${sharedCommit.slice(0, 10)}`}`,
    `           ${provenance.sharedLedgerCount} shared ledger(s) visible locally, ${provenance.events.length} AI edit(s) in total`,
  ];
  if (!claudeHooks || !prePush) lines.push("", "Run `provably init` to install what is missing.");
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
