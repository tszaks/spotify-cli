import { beforeEach, describe, expect, it } from "vitest";

import { login, spot } from "./helpers/cli.js";
import { FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  spotify.topArtists = [{ uri: "spotify:artist:nf", name: "NF" }];
  spotify.topTracks = [track("fear", "FEAR", "NF")];
  spotify.saved = [track("world", "Around the World", "Daft Punk")];
  spotify.recent = [{ track: track("robot", "Robot Rock", "Daft Punk"), played_at: "2026-11-16T20:00:00Z" }];
  await login();
});

describe("spot taste", () => {
  it("gives top, recent and saved music in one reply", async () => {
    const result = await spot(["taste"]);

    expect(result.json).toMatchObject({
      ok: true,
      topArtists: {
        lastMonth: [{ name: "NF", uri: "spotify:artist:nf" }],
        allTime: [{ name: "NF", uri: "spotify:artist:nf" }],
      },
      topTracks: { lastMonth: [expect.objectContaining({ label: "FEAR - NF" })] },
      recentlyPlayed: [expect.objectContaining({ label: "Robot Rock - Daft Punk" })],
      savedTracks: [expect.objectContaining({ label: "Around the World - Daft Punk" })],
      unavailable: [],
    });
  });

  it("gives the parts that work when the login has no top-songs permission", async () => {
    spotify.topScope = false;

    const result = await spot(["taste"]);

    expect(result.code).toBe(0);
    expect(result.json.recentlyPlayed).toHaveLength(1);
    expect(result.json.savedTracks).toHaveLength(1);
    expect(result.json.unavailable.map((gap: any) => [gap.part, gap.code])).toEqual([
      ["topArtists.allTime", "SCOPE_MISSING"],
      ["topArtists.lastMonth", "SCOPE_MISSING"],
      ["topTracks.lastMonth", "SCOPE_MISSING"],
    ]);
    expect(result.json.unavailable[0].hint).toContain("A person must run");
  });

  it("reports the cause as an error when no part works", async () => {
    spotify.intercept = () => new Response("Active premium subscription required.", { status: 403 });

    const result = await spot(["taste"]);

    expect(result.code).toBe(7);
    expect(result.json.error.code).toBe("PREMIUM_REQUIRED");
  });

  it("limits each list", async () => {
    await spot(["taste", "--limit", "5"]);

    expect(spotify.calls.every((call) => call.query.limit === "5")).toBe(true);
    expect((await spot(["taste", "--limit", "99"])).json.error.code).toBe("BAD_INPUT");
  });
});
