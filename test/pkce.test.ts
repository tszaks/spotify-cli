import { describe, expect, it } from "vitest";

import { createCodeChallenge, generateCodeVerifier } from "../src/pkce.js";

describe("pkce helpers", () => {
  it("creates the RFC 7636 code challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    await expect(createCodeChallenge(verifier)).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates a verifier in the allowed length and charset", () => {
    const verifier = generateCodeVerifier(64);

    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
  });
});
