import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** keeper/ (this file lives in keeper/src/). */
const KEEPER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The default lock path: one keeper per (chain, keeper account), the domain its nonces live in. A fork keeper and a
 * mainnet keeper with different accounts can run side by side; two keepers sharing an account cannot.
 */
export function defaultLockPath(chainId: number, keeper: string): string {
  return join(KEEPER_DIR, `.keeper-${chainId}-${keeper.toLowerCase()}.lock`);
}

export class LockHeldError extends Error {
  constructor(
    readonly path: string,
    readonly pid: number,
  ) {
    super(`another keeper (pid ${pid}) holds ${path}; stop it first, or delete the file if that pid is not a keeper`);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes the lock file (it holds the pid), or throws LockHeldError when a live process holds it. A lock left by a
 * process that is gone is taken over. `release` removes the file only while it still holds this pid.
 */
export function acquireLock(path: string, pid: number = process.pid): { path: string; release: () => void } {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, `${pid}\n`, { flag: "wx", mode: 0o644 });
      return {
        path,
        release: () => {
          try {
            if (Number(readFileSync(path, "utf8").trim()) === pid) rmSync(path);
          } catch {
            // already gone
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(holder) && holder > 0 && holder !== pid && alive(holder)) throw new LockHeldError(path, holder);
      rmSync(path, { force: true }); // stale: its process is gone
    }
  }
  throw new Error(`could not take the keeper lock ${path}`);
}
