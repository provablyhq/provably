import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl: string): boolean {
  const scriptPath = process.argv[1];
  if (scriptPath === undefined) return false;
  try {
    return realpathSync(scriptPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
