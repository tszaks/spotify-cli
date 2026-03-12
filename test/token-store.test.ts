import { describe, expect, it } from "vitest";

import { isTokenExpired } from "../src/token-store.js";

describe("token expiry", () => {
  it("treats tokens that are comfortably in the future as valid", () => {
    expect(isTokenExpired(Date.now() + 60_000)).toBe(false);
  });

  it("treats near-expiry tokens as expired so refresh happens early", () => {
    expect(isTokenExpired(Date.now() + 5_000)).toBe(true);
  });
});
