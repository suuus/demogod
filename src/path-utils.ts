import { realpathSync } from "fs";
import { resolve, sep } from "path";
import { homedir } from "os";

/** Resolve path and follow symlinks; returns null if path doesn't exist */
export function safeRealpath(p: string): string | null {
  try { return realpathSync(resolve(p)); } catch { return null; }
}

/** Check if a resolved real path is under the user's home directory */
export function isUnderHome(realPath: string): boolean {
  const home = homedir();
  return realPath === home || realPath.startsWith(home + sep);
}
