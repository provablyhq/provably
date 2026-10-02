import { repoRoot, loadLedger, gradeLedger, survivalRecall, type SurvivalTotals } from "./grade-ledger.js";
import type { LedgerEvent } from "./ledger.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`.padStart(7);
}

function reportRow(label: string, totals: SurvivalTotals): string {
  return [
    label.padEnd(36),
    percent(survivalRecall(totals)),
    `${totals.recalledAiLines}/${totals.survivedAiLines}`.padStart(10),
  ].join("  ");
}

function main(argv: readonly string[]): number {
  const ledgerPath = argv[0];
  const rev = argv[1] ?? "HEAD";
  const root = repoRoot(process.cwd());

  let events: LedgerEvent[];
  try {
    events = loadLedger(root, ledgerPath);
  } catch {
    console.error(`no readable ledger (looked at ${ledgerPath ?? ".ai-provenance/ledger.jsonl"})`);
    return 2;
  }

  if (events.length === 0) {
    console.error("ledger is empty: nothing to grade");
    return 2;
  }

  const { files, overall, gradablePairs } = gradeLedger(root, rev, events);

  console.log("Grader: real ledger, AI-line survival recall across committed states");
  console.log(`  repo ${root}`);
  console.log(`  ${events.length} ledger event(s) across ${files.length} file(s), graded up to ${rev}`);
  console.log("");
  console.log("This measures recall only: of the AI lines captured at an earlier committed state,");
  console.log("how many the engine still flags at a later one. Precision and false-flag rate are");
  console.log("not derivable here, because the ledger only ever asserts AI, never human. The");
  console.log("precision gate lives in npm run grade:git, which has true negatives by construction.");
  console.log("");

  console.log("Anchored states per file (a gradable pair needs two or more)");
  for (const result of files) {
    console.log(`  ${result.file}: ${result.anchorCount} anchored, ${result.pairCount} pair`);
  }
  console.log("");

  if (gradablePairs === 0) {
    console.log("No gradable anchor pairs found.");
    console.log("A pair needs the same file committed twice, each commit matching a ledger event:");
    console.log("the AI edits a file and it is committed, then the AI edits it again and that is committed.");
    return 0;
  }

  const header = ["scope".padEnd(36), "ai-line-recall", "recalled"].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const result of files) {
    if (result.pairCount === 0) continue;
    console.log(reportRow(`${result.file} (${result.pairCount} pair)`, result.totals));
  }
  console.log("-".repeat(header.length));
  console.log(reportRow(`OVERALL (${gradablePairs} pair)`, overall));

  return 0;
}

process.exit(main(process.argv.slice(2)));
