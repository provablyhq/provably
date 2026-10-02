import { mkdtempSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.js";

export interface ChangedFile {
  readonly status: "added" | "modified";
  readonly path: string;
}

export function snapshotWorktree(repoDir: string): string {
  const realIndex = git(repoDir, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "provably-index-"));
  const temporaryIndex = join(temporaryDirectory, "index");
  try {
    if (existsSync(realIndex)) copyFileSync(realIndex, temporaryIndex);
    const environment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
    git(repoDir, ["add", "-A"], environment);
    return git(repoDir, ["write-tree"], environment).trim();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function changedFilesBetween(repoDir: string, beforeTree: string, afterTree: string): ChangedFile[] {
  const output = git(repoDir, ["diff-tree", "-r", "--no-renames", "--name-status", "-z", beforeTree, afterTree]);
  const fields = output.split("\0").filter((field) => field !== "");
  const changed: ChangedFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index]!;
    const path = fields[index + 1]!;
    if (status === "A") changed.push({ status: "added", path });
    else if (status === "M") changed.push({ status: "modified", path });
  }
  return changed;
}

export function fileInTree(repoDir: string, tree: string, path: string): string {
  return git(repoDir, ["cat-file", "blob", `${tree}:${path}`]);
}
