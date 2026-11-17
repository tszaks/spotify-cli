import { describe, expect, it } from "vitest";

import { exitCodeFor, spotifyHttpError, SpotError, toErrorPayload } from "../src/errors.js";

describe("spotifyHttpError", () => {
  it("keeps the full text of a plain-text reply", () => {
    // The exact reply that Spotify sent on 2026-11-16. The old CLI showed "Unexpected token 'A'".
    const body = "Active premium subscription required for the owner of the app. When the subscription status changes, it can take a few hours before requests are allowed again.";
    const error = spotifyHttpError(403, body, null);

    expect(error.code).toBe("PREMIUM_REQUIRED");
    expect(error.message).toBe(body);
    expect(error.hint).toContain("Premium");
  });

  it("reads the reason of a player error", () => {
    const body = JSON.stringify({
      error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" },
    });

    expect(spotifyHttpError(404, body, null).code).toBe("NO_ACTIVE_DEVICE");
  });

  it("tells a missing permission from other refusals", () => {
    const scope = JSON.stringify({ error: { status: 403, message: "Insufficient client scope" } });
    const restriction = JSON.stringify({
      error: { status: 403, message: "Player command failed: Restriction violated" },
    });

    expect(spotifyHttpError(403, scope, null).code).toBe("SCOPE_MISSING");
    expect(spotifyHttpError(403, restriction, null).code).toBe("FORBIDDEN");
  });

  it("tells a used-up quota from a short rate limit", () => {
    const quota = JSON.stringify({ error: { status: 429, message: "Quota exceeded" }, reason: "QUOTA_EXCEEDED" });

    expect(spotifyHttpError(429, quota, "3600").code).toBe("QUOTA_EXCEEDED");
    const limited = spotifyHttpError(429, "", "7");
    expect(limited.code).toBe("RATE_LIMITED");
    expect(limited.retryAfterSeconds).toBe(7);
  });

  it("gives a message when the reply is empty", () => {
    expect(spotifyHttpError(502, "", null).message).toBe("Spotify replied with HTTP 502.");
  });
});

describe("toErrorPayload", () => {
  it("puts extra data next to the code and hint", () => {
    const payload = toErrorPayload(
      new SpotError("NO_ACTIVE_DEVICE", "No device.", { hint: "Open Spotify.", extra: { devices: [] } }),
    );

    expect(payload).toMatchObject({ code: "NO_ACTIVE_DEVICE", hint: "Open Spotify.", devices: [] });
  });

  it("marks an unknown error as INTERNAL", () => {
    expect(toErrorPayload(new Error("boom"))).toEqual({ code: "INTERNAL", message: "boom" });
  });
});

describe("exitCodeFor", () => {
  it("gives each group of errors its own exit code", () => {
    expect(exitCodeFor("BAD_INPUT")).toBe(2);
    expect(exitCodeFor("NOT_LOGGED_IN")).toBe(3);
    expect(exitCodeFor("NO_ACTIVE_DEVICE")).toBe(4);
    expect(exitCodeFor("NOT_FOUND")).toBe(5);
    expect(exitCodeFor("RATE_LIMITED")).toBe(6);
    expect(exitCodeFor("PREMIUM_REQUIRED")).toBe(7);
  });
});
