import { git } from "./git.js";
import { syncLedger } from "./ledger-sync.js";

export function runSync(argv: readonly string[]): number {
  let remote = "origin";
  let quiet = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--quiet") quiet = true;
    else if (flag === "--remote" && argv[index + 1] !== undefined) remote = argv[++index]!;
    else {
      process.stderr.write("usage: provably sync [--remote <name-or-url>] [--quiet]\n");
      return 2;
    }
  }
  let repoRoot: string;
  try {
    repoRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    process.stderr.write("provably sync must run inside a git repository\n");
    return 2;
  }
  try {
    const result = syncLedger(repoRoot, remote);
    if (quiet) return 0;
    if (result.status === "no-ledger") process.stdout.write("provably: no AI edits to committed files yet, nothing to share\n");
    else if (result.status === "up-to-date") process.stdout.write(`provably: provenance already shared with ${remote}\n`);
    else process.stdout.write(`provably: shared ${result.ledger!.eventCount} AI edit(s) and ${result.ledger!.snapshotCount} snapshot(s) with ${remote}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`provably: could not share provenance with ${remote}: ${(error as Error).message.split("\n")[0]}\n`);
    return quiet ? 0 : 1;
  }
}
