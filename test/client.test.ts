import { readFile, stat } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { TOKEN_PATH } from "../src/paths.js";
import { spotifyRequest } from "../src/spotify-client.js";
import { login, logout } from "./helpers/cli.js";
import { device, FakeSpotify } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  await login();
});

describe("spotifyRequest", () => {
  it("reports Spotify's plain-text refusal with its real message", async () => {
    spotify.intercept = () =>
      new Response("Active premium subscription required for the owner of the app.", { status: 403 });

    await expect(spotifyRequest("/me/player/devices")).rejects.toMatchObject({
      code: "PREMIUM_REQUIRED",
      status: 403,
      message: "Active premium subscription required for the owner of the app.",
    });
  });

  it("accepts a success reply that is not JSON", async () => {
    await expect(spotifyRequest("/me/player/next", { method: "POST" })).resolves.toBeUndefined();
  });

  it("waits and tries again after a short rate limit", async () => {
    let refusals = 2;
    spotify.intercept = () => {
      if (refusals > 0) {
        refusals -= 1;
        return new Response("", { status: 429, headers: { "retry-after": "1" } });
      }

      return undefined;
    };
    spotify.devices = [device("d1", "Mac")];

    const data = await spotifyRequest<{ devices: unknown[] }>("/me/player/devices");

    expect(data.devices).toHaveLength(1);
    expect(spotify.calls).toHaveLength(3);
  });

  it("gives a long rate limit back to the caller with the wait time", async () => {
    spotify.intercept = () => new Response("", { status: 429, headers: { "retry-after": "120" } });

    await expect(spotifyRequest("/me")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 120,
    });
    expect(spotify.calls).toHaveLength(1);
  });

  it("does not try again when the quota is used up", async () => {
    spotify.intercept = () =>
      new Response(JSON.stringify({ reason: "QUOTA_EXCEEDED" }), {
        status: 429,
        headers: { "retry-after": "1" },
      });

    await expect(spotifyRequest("/me")).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(spotify.calls).toHaveLength(1);
  });

  it("tries a read again after a server error, but not a write", async () => {
    spotify.intercept = () => new Response("", { status: 502 });

    await expect(spotifyRequest("/me")).rejects.toMatchObject({ code: "SPOTIFY_ERROR" });
    expect(spotify.calls).toHaveLength(3);

    spotify.calls = [];
    await expect(spotifyRequest("/me/player/queue", { method: "POST" })).rejects.toMatchObject({
      code: "SPOTIFY_ERROR",
    });
    expect(spotify.calls).toHaveLength(1);
  });

  it("gets a new token when Spotify says the token expired, then tries again", async () => {
    spotify.validToken = "access-9";

    const profile = await spotifyRequest<{ id: string }>("/me");

    expect(profile.id).toBe("tester");
    expect(spotify.refreshes).toBe(1);
    expect(spotify.calls.map((call) => call.token)).toEqual(["access-0", "access-1"]);
  });

  it("refreshes one time when many requests start with an expired token", async () => {
    await login({ expiresAt: Date.now() - 1000 });

    await Promise.all([spotifyRequest("/me"), spotifyRequest("/me"), spotifyRequest("/me")]);

    expect(spotify.refreshes).toBe(1);
  });

  it("saves the new login so that only the owner can read it", async () => {
    await login({ expiresAt: Date.now() - 1000 });

    await spotifyRequest("/me");

    const saved = JSON.parse(await readFile(TOKEN_PATH, "utf8"));
    expect(saved.accessToken).toBe("access-1");
    expect((await stat(TOKEN_PATH)).mode & 0o777).toBe(0o600);
  });

  it("says who must log in when there is no login", async () => {
    await logout();

    await expect(spotifyRequest("/me")).rejects.toMatchObject({
      code: "NOT_LOGGED_IN",
      hint: expect.stringContaining("A person must run"),
    });
  });

  it("reports a network failure as NETWORK", async () => {
    spotify.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    spotify.install();

    await expect(spotifyRequest("/me")).rejects.toMatchObject({ code: "NETWORK" });
  });
});
