import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { LOGIN_HINT, SpotError } from "./errors.js";

export type SpotifyTokenSet = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  tokenType: string;
  expiresAt: number;
};

const EXPIRY_SKEW_MS = 10_000;

export function isTokenExpired(expiresAt: number): boolean {
  return expiresAt <= Date.now() + EXPIRY_SKEW_MS;
}

async function readJsonFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function readTokenStore(path: string): Promise<SpotifyTokenSet | null> {
  for (let attempt = 1; ; attempt += 1) {
    const raw = await readJsonFile(path);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as SpotifyTokenSet;
    } catch {
      // A different process can be in the middle of a write. Look one more time before giving up.
      if (attempt >= 2) {
        throw new SpotError("NOT_LOGGED_IN", "The saved Spotify login file is damaged.", {
          hint: LOGIN_HINT,
        });
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 80);
      });
    }
  }
}

export async function writeTokenStore(
  path: string,
  tokens: SpotifyTokenSet,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Private temp file, then rename: no other user can read it, and no reader sees half a file.
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(tokens, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, path);
}

export async function deleteTokenStore(path: string): Promise<void> {
  await rm(path, { force: true });
}

// Spotify gives a new refresh token on each refresh and cancels the old one.
// Two agents that refresh at the same time would log each other out, so one waits for the other.
export async function withFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: { staleMs?: number; waitMs?: number } = {},
): Promise<T> {
  const staleMs = options.staleMs ?? 30_000;
  const deadline = Date.now() + (options.waitMs ?? 15_000);
  await mkdir(dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const age = await stat(lockPath).then(
        (info) => Date.now() - info.mtimeMs,
        () => Number.POSITIVE_INFINITY,
      );

      // A crashed process leaves its lock behind. Take the lock when it is old or the wait is over.
      if (age > staleMs || Date.now() > deadline) {
        await rm(lockPath, { force: true });
        continue;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { force: true });
  }
}
