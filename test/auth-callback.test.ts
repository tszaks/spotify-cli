import { describe, expect, it } from "vitest";

import { parseAuthorizationCallbackUrl } from "../src/auth-callback.js";

describe("parseAuthorizationCallbackUrl", () => {
  it("extracts the code and validates state", () => {
    expect(
      parseAuthorizationCallbackUrl(
        "https://szakacsmedia.com/spotify-cli/callback?code=abc123&state=state-1",
        "state-1",
      ),
    ).toBe("abc123");
  });

  it("rejects callback urls without a code", () => {
    expect(() =>
      parseAuthorizationCallbackUrl(
        "https://szakacsmedia.com/spotify-cli/callback?state=state-1",
        "state-1",
      ),
    ).toThrow("Spotify did not return an authorization code.");
  });

  it("rejects callback urls with the wrong state", () => {
    expect(() =>
      parseAuthorizationCallbackUrl(
        "https://szakacsmedia.com/spotify-cli/callback?code=abc123&state=wrong",
        "state-1",
      ),
    ).toThrow("Spotify returned an unexpected state value.");
  });
});
