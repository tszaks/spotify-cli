import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { AUTH_SESSION_PATH } from "./paths.js";

export type AuthSession = {
  codeVerifier: string;
  createdAt: number;
  state: string;
};

export async function readAuthSession(): Promise<AuthSession | null> {
  try {
    const raw = await readFile(AUTH_SESSION_PATH, "utf8");
    return JSON.parse(raw) as AuthSession;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }

    throw error;
  }
}

export async function writeAuthSession(session: AuthSession): Promise<void> {
  await mkdir(dirname(AUTH_SESSION_PATH), { recursive: true });
  // The code verifier is a login secret until `auth finish` uses it.
  await writeFile(AUTH_SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function deleteAuthSession(): Promise<void> {
  await rm(AUTH_SESSION_PATH, { force: true });
}
