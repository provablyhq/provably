import { readFileSync } from "node:fs";
import { parseLedger, type LedgerEvent } from "./ledger.js";
import { isMainModule } from "./entry.js";

function aiCharCount(event: LedgerEvent): number {
  return event.aiRanges.reduce((sum, range) => sum + (range[1] - range[0]), 0);
}

export function runLedger(argv: readonly string[]): number {
  const command = argv[0];
  const path = argv[1];
  if (!command || !path) {
    process.stderr.write("usage: ledger <validate|show> <path-to-ledger.jsonl>\n");
    return 2;
  }

  let jsonl: string;
  try {
    jsonl = readFileSync(path, "utf8");
  } catch {
    process.stderr.write(`cannot read ledger at ${path}\n`);
    return 2;
  }

  let events: LedgerEvent[];
  try {
    events = parseLedger(jsonl);
  } catch (error) {
    process.stderr.write(`invalid ledger: ${(error as Error).message}\n`);
    return 1;
  }

  if (command === "validate") {
    const totalAiChars = events.reduce((sum, event) => sum + aiCharCount(event), 0);
    process.stdout.write(`ok: ${events.length} event(s), ${totalAiChars} ai-char(s)\n`);
    return 0;
  }

  if (command === "show") {
    for (const event of events) {
      process.stdout.write(
        `${event.ts}  ${event.tool}  ${event.file}  ${event.aiRanges.length} range(s)  ${aiCharCount(event)} ai-char(s)\n`,
      );
    }
    return 0;
  }

  process.stderr.write(`unknown command: ${command}\n`);
  return 2;
}

if (isMainModule(import.meta.url)) process.exit(runLedger(process.argv.slice(2)));
