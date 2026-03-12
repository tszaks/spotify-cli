import { createHash, randomBytes } from "node:crypto";

const PKCE_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-";

export function generateCodeVerifier(length = 64): string {
  const size = Math.min(128, Math.max(43, length));
  const bytes = randomBytes(size);

  return Array.from(bytes, (value) => PKCE_CHARSET[value % PKCE_CHARSET.length])
    .join("")
    .slice(0, size);
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}
