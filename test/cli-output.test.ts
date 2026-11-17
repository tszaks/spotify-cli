import { beforeEach, describe, expect, it } from "vitest";

import { login, logout, spot } from "./helpers/cli.js";
import { device, FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  spotify.catalog = [track("fear", "FEAR", "NF")];
  spotify.devices = [device("d1", "Mac", true)];
  await login();
});

describe("output mode", () => {
  it("prints one JSON object when no terminal is attached", async () => {
    const result = await spot(["devices", "list"]);

    expect(result.code).toBe(0);
    expect(result.out.split("\n")).toHaveLength(1);
    expect(result.json).toEqual({
      ok: true,
      devices: [{ id: "d1", name: "Mac", type: "Computer", active: true, volume: 50, restricted: false }],
    });
  });

  it("prints text for a person at a terminal", async () => {
    const result = await spot(["devices", "list"], { tty: true });

    expect(result.out).toBe("Mac (Computer) id=d1 volume=50 active");
    expect(result.json).toBeUndefined();
  });

  it("obeys --json and --text in any position", async () => {
    expect((await spot(["devices", "list", "--json"], { tty: true })).json.ok).toBe(true);
    expect((await spot(["--text", "devices", "list"])).out).toContain("Mac (Computer)");
  });

  it("obeys SPOT_OUTPUT, and a flag wins over it", async () => {
    expect((await spot(["devices", "list"], { tty: true, env: { SPOT_OUTPUT: "json" } })).json.ok).toBe(true);
    expect((await spot(["devices", "list", "--text"], { env: { SPOT_OUTPUT: "json" } })).json).toBeUndefined();
  });

  it("gives search results as data with the URI of each item", async () => {
    const result = await spot(["search", "fear nf", "--type", "track"]);

    expect(result.json.results.tracks).toEqual([
      { type: "track", name: "FEAR", uri: "spotify:track:fear", artists: ["NF"], label: "FEAR - NF" },
    ]);
  });

  it("drops the empty slots that Spotify puts in playlist results", async () => {
    const result = await spot(["search", "fear", "--type", "playlist"]);

    expect(result.json.results.playlists).toEqual([]);
  });

  it("keeps the old text of search for people", async () => {
    const result = await spot(["search", "fear nf", "--type", "track"], { tty: true });

    expect(result.out).toBe("\ntracks\n------\nFEAR - NF (spotify:track:fear)");
  });
});

describe("errors", () => {
  it("gives a code, the real message, a hint and an exit code", async () => {
    spotify.intercept = () =>
      new Response("Active premium subscription required for the owner of the app.", { status: 403 });

    const result = await spot(["devices", "list"]);

    expect(result.code).toBe(7);
    expect(result.json).toEqual({
      ok: false,
      error: {
        code: "PREMIUM_REQUIRED",
        message: "Active premium subscription required for the owner of the app.",
        hint: expect.stringContaining("Premium"),
        status: 403,
      },
    });
  });

  it("prints the error and hint as text for a person", async () => {
    await logout();

    const result = await spot(["devices", "list"], { tty: true });

    expect(result.code).toBe(3);
    expect(result.out).toBe("");
    expect(result.err).toBe(
      "Error (NOT_LOGGED_IN): No Spotify login found.\nHint: A person must run `spot auth login` and then `spot auth finish`.",
    );
  });

  it("reports a wrong option as BAD_INPUT in JSON", async () => {
    const result = await spot(["devices", "list", "--nope"]);

    expect(result.code).toBe(2);
    expect(result.json.error.code).toBe("BAD_INPUT");
    expect(result.json.error.message).toContain("--nope");
    expect(result.err).toBe("");
  });

  it("reports a missing subcommand as BAD_INPUT in JSON", async () => {
    const result = await spot(["playlist"]);

    expect(result.code).toBe(2);
    expect(result.json.error).toMatchObject({ code: "BAD_INPUT", message: "This command needs a subcommand." });
  });

  it("reports a wrong value as BAD_INPUT", async () => {
    const result = await spot(["playback", "volume", "150"]);

    expect(result.code).toBe(2);
    expect(result.json.error).toMatchObject({ code: "BAD_INPUT", message: "volume must be at most 100." });
  });

  it("reports a wrong search type before it calls Spotify", async () => {
    const result = await spot(["search", "x", "--type", "song"]);

    expect(result.json.error).toMatchObject({ code: "BAD_INPUT", message: "Unknown search type: song." });
    expect(spotify.calls).toHaveLength(0);
  });
});

describe("help, version and guide", () => {
  it("prints help as text with exit code 0", async () => {
    const result = await spot(["--help"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: spot");
    expect(result.out).toContain("spot guide");
  });

  it("prints the version", async () => {
    expect((await spot(["--version"])).out).toBe("2.0.2");
  });

  it("prints the agent manual as plain text in both modes", async () => {
    const result = await spot(["guide"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("# spot");
    expect(result.out).toContain("spot dj start");
    expect(result.json).toBeUndefined();
  });
});

describe("commands that had text only", () => {
  it("gives recent songs as data, up to 50", async () => {
    spotify.recent = [{ track: track("fear", "FEAR", "NF"), played_at: "2026-11-16T20:00:00Z" }];

    const result = await spot(["recent", "--limit", "50"]);

    expect(result.json.tracks).toEqual([
      expect.objectContaining({ label: "FEAR - NF", playedAt: "2026-11-16T20:00:00Z" }),
    ]);
    expect(spotify.calls[0].query.limit).toBe("50");
  });

  it("says what a player command did", async () => {
    spotify.player = { is_playing: true, shuffle: false, repeat: "off", progress_ms: 0 };

    expect((await spot(["playback", "pause"])).json).toEqual({ ok: true, action: "pause" });
    expect((await spot(["playback", "next"])).json).toEqual({ ok: true, action: "next" });
    expect((await spot(["playback", "volume", "35"])).json).toEqual({ ok: true, action: "volume", volume: 35 });
  });

  it("explains a pause that Spotify refuses", async () => {
    spotify.player = { is_playing: false, shuffle: false, repeat: "off", progress_ms: 0 };

    const result = await spot(["playback", "pause"]);

    expect(result.json.error).toMatchObject({
      code: "FORBIDDEN",
      hint: expect.stringContaining("already paused"),
    });
  });

  it("shows the account with no private fields", async () => {
    expect((await spot(["me"])).json).toEqual({
      ok: true,
      id: "tester",
      displayName: "Tester",
      uri: "spotify:user:tester",
    });
  });

  it("cuts the client ID short in config show", async () => {
    const result = await spot(["config", "show"]);

    expect(result.out).not.toContain("test-client");
    expect(result.json.resolved.clientId).toBe("test-c...");
  });
});
