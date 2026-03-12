import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export async function readTokenStore(path: string): Promise<SpotifyTokenSet | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SpotifyTokenSet;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }

    throw error;
  }
}

export async function writeTokenStore(
  path: string,
  tokens: SpotifyTokenSet,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
}

export async function deleteTokenStore(path: string): Promise<void> {
  await rm(path, { force: true });
}
