import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hashContent } from "./ledger.js";

export const LEDGER_DIRECTORY = ".ai-provenance";
export const SNAPSHOT_DIRECTORY = "blobs";

export function readSnapshot(ledgerDirectory: string, contentSha256: string): string | null {
  try {
    const content = readFileSync(join(ledgerDirectory, SNAPSHOT_DIRECTORY, contentSha256), "utf8");
    return hashContent(content) === contentSha256 ? content : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(ledgerDirectory: string, contentSha256: string, content: string): void {
  mkdirSync(join(ledgerDirectory, SNAPSHOT_DIRECTORY), { recursive: true });
  writeFileSync(join(ledgerDirectory, SNAPSHOT_DIRECTORY, contentSha256), content, "utf8");
}

export function snapshotReaderForRepo(repoRoot: string): (contentSha256: string) => string | null {
  const ledgerDirectory = join(repoRoot, LEDGER_DIRECTORY);
  return (contentSha256) => readSnapshot(ledgerDirectory, contentSha256);
}
