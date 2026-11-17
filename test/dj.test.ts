import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { DJ_SESSION_PATH } from "../src/paths.js";
import { login, logout, spot } from "./helpers/cli.js";
import { device, FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

const SET = "Band - One\nBand - Two\nBand - Three\nBand - Four\nBand - Five";
const uri = (name: string) => `spotify:track:${name}`;

// Copies what Spotify does while the user listens: the player moves on, and plays of 30 seconds are recorded.
function listen(played: string[], current: string): void {
  for (const name of played) {
    spotify.recent.push({ track: spotify.find(uri(name)), played_at: new Date(Date.now() + 1000).toISOString() });
  }

  spotify.player!.item = spotify.find(uri(current));
}

beforeEach(async () => {
  await logout();
  spotify = new FakeSpotify().install();
  spotify.catalog = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"].map((name) =>
    track(name.toLowerCase(), name, "Band"));
  spotify.devices = [device("d1", "iPhone", true, "Smartphone")];
  await login();
});

describe("spot dj start", () => {
  it("writes the set into one playlist and starts it at the first song, in order", async () => {
    const result = await spot(
      ["dj", "start", "--name", "Deep focus", "--note", "calm, no vocals", "--from", "-"],
      { stdin: SET },
    );

    const [playlist] = [...spotify.playlists.values()];
    expect(playlist.name).toBe("spot DJ");
    expect(playlist.public).toBe(false);
    expect(playlist.items).toEqual(["one", "two", "three", "four", "five"].map(uri));
    expect(playlist.description).toContain("Deep focus · calm, no vocals");

    expect(spotify.player).toMatchObject({
      context_uri: `spotify:playlist:${playlist.id}`,
      item: { uri: uri("one") },
      is_playing: true,
      shuffle: false,
    });
    expect(result.json).toMatchObject({
      ok: true,
      session: { name: "Deep focus", note: "calm, no vocals", songs: 5 },
      device: { name: "iPhone" },
      missed: [],
    });
    expect(result.json.tracks.map((item: any) => item.label)).toEqual([
      "One - Band", "Two - Band", "Three - Band", "Four - Band", "Five - Band",
    ]);
  });

  it("uses the same playlist for the next set", async () => {
    await spot(["dj", "start", "Band - One", "Band - Two"]);
    await spot(["dj", "start", "Band - Six", "Band - Seven"]);

    expect(spotify.playlists.size).toBe(1);
    expect([...spotify.playlists.values()][0].items).toEqual([uri("six"), uri("seven")]);
  });

  it("uses a playlist with the DJ name that is already in the account", async () => {
    const existing = spotify.addPlaylist("spot DJ", [uri("seven")]);

    await spot(["dj", "start", "Band - One"]);

    expect(spotify.playlists.size).toBe(1);
    expect(existing.items).toEqual([uri("one")]);
  });

  it("starts with the songs it found and reports the songs it did not find", async () => {
    const result = await spot(["dj", "start", "Band - One", "Nobody - Zzzz Qqqq"]);

    expect(result.json.session.songs).toBe(1);
    expect(result.json.missed).toEqual([expect.objectContaining({ input: "Nobody - Zzzz Qqqq" })]);
  });

  it("changes nothing when no device can play", async () => {
    spotify.devices = [];

    const result = await spot(["dj", "start", "Band - One"]);

    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe("NO_ACTIVE_DEVICE");
    expect(spotify.player).toBeNull();
    expect(spotify.playlists.size).toBe(0);
    expect(spotify.calls.every((call) => call.method === "GET")).toBe(true);
    await expect(readFile(DJ_SESSION_PATH, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("changes nothing when the list has an album in it", async () => {
    const result = await spot(["dj", "start", "Band - One", "spotify:album:abc"]);

    expect(result.json.error.code).toBe("BAD_INPUT");
    expect(spotify.playlists.size).toBe(0);
    expect(spotify.player).toBeNull();
  });

  it("needs songs", async () => {
    expect((await spot(["dj", "start"])).json.error.code).toBe("BAD_INPUT");
  });
});

describe("spot dj status", () => {
  it("tells played, skipped and remaining songs apart", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    // The user heard One, skipped Two, heard Three, and is now on Four.
    listen(["one", "three"], "four");

    const result = await spot(["dj", "status"]);

    expect(result.json).toMatchObject({
      ok: true,
      inSession: true,
      isPlaying: true,
      current: { label: "Four - Band" },
      played: [{ uri: uri("one"), label: "One - Band" }, { uri: uri("three"), label: "Three - Band" }],
      skipped: [{ uri: uri("two"), label: "Two - Band" }],
      remaining: [{ uri: uri("five"), label: "Five - Band" }],
    });
    expect(result.json.how).toContain("30 seconds");
  });

  it("counts a play of a different copy of the same song", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    spotify.recent.push({
      track: { ...spotify.find(uri("one")), uri: "spotify:track:one-other-market" },
      played_at: new Date(Date.now() + 1000).toISOString(),
    });
    spotify.player!.item = spotify.find(uri("two"));

    const result = await spot(["dj", "status"]);

    expect(result.json.played.map((item: any) => item.label)).toEqual(["One - Band"]);
    expect(result.json.skipped).toEqual([]);
  });

  it("does not count plays from before the set started", async () => {
    spotify.recent.push({ track: track("one", "One", "Band"), played_at: "2026-01-01T00:00:00Z" });
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    listen([], "two");

    expect((await spot(["dj", "status"])).json.skipped.map((item: any) => item.label)).toEqual(["One - Band"]);
  });

  it("says when the user moved to different music, and calls nothing skipped", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    listen(["one"], "two");
    spotify.player!.context_uri = "spotify:album:other";

    const result = await spot(["dj", "status"]);

    expect(result.json).toMatchObject({ inSession: false, current: null, skipped: [] });
    expect(result.json.played.map((item: any) => item.label)).toEqual(["One - Band"]);
    expect(result.json.remaining).toHaveLength(4);
  });

  it("reports that there is no session", async () => {
    const result = await spot(["dj", "status"]);

    expect(result.code).toBe(5);
    expect(result.json.error).toMatchObject({ code: "NOT_FOUND", hint: expect.stringContaining("spot dj start") });
  });
});

describe("spot dj steer", () => {
  it("replaces the songs that come next and keeps the current song", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    listen(["one"], "two");
    const playsBefore = spotify.callsTo("PUT", "/me/player/play").length;

    const result = await spot(["dj", "steer", "Band - Six", "Band - Seven"]);

    expect([...spotify.playlists.values()][0].items).toEqual(["one", "two", "six", "seven"].map(uri));
    expect(result.json).toMatchObject({ ok: true, kept: 2, removed: 3 });
    expect(result.json.added.map((item: any) => item.label)).toEqual(["Six - Band", "Seven - Band"]);
    // No new play command: the current song is not cut.
    expect(spotify.callsTo("PUT", "/me/player/play")).toHaveLength(playsBefore);

    listen(["two"], "six");
    expect((await spot(["dj", "status"])).json).toMatchObject({
      current: { label: "Six - Band" },
      remaining: [{ label: "Seven - Band" }],
    });
  });

  it("does not add a song that was already played in this set", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    listen(["one"], "two");

    const result = await spot(["dj", "steer", "Band - One", "Band - Six"]);

    expect(result.json.added.map((item: any) => item.label)).toEqual(["Six - Band"]);
    expect([...spotify.playlists.values()][0].items).toEqual(["one", "two", "six"].map(uri));
  });

  it("refuses when the set is not playing", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    spotify.player!.context_uri = "spotify:album:other";

    const result = await spot(["dj", "steer", "Band - Six"]);

    expect(result.json.error).toMatchObject({ code: "NOT_FOUND", message: "The DJ set is not playing now." });
    expect([...spotify.playlists.values()][0].items).toHaveLength(5);
  });
});

describe("spot dj stop", () => {
  it("pauses the set and gives the final report", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    listen(["one"], "three");

    const result = await spot(["dj", "stop"]);

    expect(spotify.player?.is_playing).toBe(false);
    expect(result.json).toMatchObject({
      ok: true,
      isPlaying: false,
      session: { ended: true },
      played: [{ label: "One - Band" }],
      skipped: [{ label: "Two - Band" }],
    });
  });

  it("does not pause different music", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    spotify.player!.context_uri = "spotify:album:other";

    await spot(["dj", "stop"]);

    expect(spotify.player?.is_playing).toBe(true);
  });

  it("works when the music is already paused", async () => {
    await spot(["dj", "start", "--from", "-"], { stdin: SET });
    spotify.player!.is_playing = false;

    expect((await spot(["dj", "stop"])).json.ok).toBe(true);
  });
});
