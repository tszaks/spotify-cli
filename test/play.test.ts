import { beforeEach, describe, expect, it } from "vitest";

import { login, spot } from "./helpers/cli.js";
import { device, FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  spotify.catalog = [
    track("happy", "HAPPY", "NF"),
    track("fear", "FEAR", "NF"),
    track("water", "Fear Of Water", "Noah Kahan"),
  ];
  spotify.artists = [{ uri: "spotify:artist:daft", name: "Daft Punk" }];
  spotify.devices = [device("d1", "Mac", true)];
  await login();
});

describe("spot play", () => {
  it("finds a song by name and plays it in one command", async () => {
    const result = await spot(["play", "fear", "nf"]);

    expect(result.json).toMatchObject({
      ok: true,
      action: "playing",
      item: { uri: "spotify:track:fear", type: "track", label: "FEAR - NF" },
      device: { name: "Mac" },
    });
    expect(spotify.player?.item?.uri).toBe("spotify:track:fear");
  });

  it("selects the result that fits the words, not the first result", async () => {
    // Real Spotify put "HAPPY - NF" first for "fear nf" on 2026-11-16. The fake sends the same order.
    spotify.intercept = (call) =>
      call.path === "/search"
        ? new Response(JSON.stringify({ tracks: { items: spotify.catalog } }), { status: 200 })
        : undefined;

    await spot(["play", "nf fear"]);

    expect(spotify.callsTo("PUT", "/me/player/play")[0].body).toEqual({ uris: ["spotify:track:fear"] });
  });

  it("plays an artist as a context", async () => {
    const result = await spot(["play", "daft punk", "--type", "artist"]);

    expect(result.json.item).toMatchObject({ uri: "spotify:artist:daft", type: "artist" });
    expect(spotify.callsTo("PUT", "/me/player/play")[0].body).toEqual({ context_uri: "spotify:artist:daft" });
  });

  it("plays one of the user's own playlists by name with --mine", async () => {
    const playlist = spotify.addPlaylist("Road Trip", ["spotify:track:fear"]);

    const result = await spot(["play", "road trip", "--mine"]);

    expect(result.json.item).toMatchObject({ uri: `spotify:playlist:${playlist.id}`, label: "Road Trip" });
  });

  it("accepts a URI or a link and does no search", async () => {
    await spot(["play", "https://open.spotify.com/track/fear?si=1"]);

    expect(spotify.callsTo("GET", "/search")).toHaveLength(0);
    expect(spotify.player?.item?.uri).toBe("spotify:track:fear");
  });

  it("adds to the queue with --queue and leaves the current song", async () => {
    const result = await spot(["play", "nf fear", "--queue"]);

    expect(result.json).toMatchObject({ ok: true, action: "queued", item: { label: "FEAR - NF" } });
    expect(spotify.queue).toEqual(["spotify:track:fear"]);
    expect(spotify.callsTo("PUT", "/me/player/play")).toHaveLength(0);
  });

  it("refuses to queue an album", async () => {
    const result = await spot(["play", "spotify:album:x", "--queue"]);

    expect(result.json.error.code).toBe("BAD_INPUT");
    expect(spotify.queue).toEqual([]);
  });

  it("resumes when no words are given", async () => {
    spotify.player = { is_playing: false, shuffle: false, repeat: "off", progress_ms: 5 };

    const result = await spot(["play"]);

    expect(result.json).toMatchObject({ ok: true, action: "resumed" });
    expect(spotify.player.is_playing).toBe(true);
  });

  it("reports NOT_FOUND when Spotify has nothing", async () => {
    const result = await spot(["play", "zzzz qqqq"]);

    expect(result.code).toBe(5);
    expect(result.json.error.code).toBe("NOT_FOUND");
  });

  it("lists the devices when it cannot tell where to play", async () => {
    spotify.devices = [device("d1", "Mac"), device("d2", "Patio Amp")];

    const result = await spot(["play", "nf fear"]);

    expect(result.code).toBe(4);
    expect(result.json.error).toMatchObject({
      code: "NO_ACTIVE_DEVICE",
      devices: [expect.objectContaining({ name: "Mac" }), expect.objectContaining({ name: "Patio Amp" })],
    });
    expect(spotify.player).toBeNull();
  });

  it("plays on the device that the caller names", async () => {
    spotify.devices = [device("d1", "Mac"), device("d2", "Patio Amp")];

    const result = await spot(["play", "nf fear", "--device", "mac"]);

    expect(result.json.device.name).toBe("Mac");
    expect(spotify.callsTo("PUT", "/me/player/play")[0].query.device_id).toBe("d1");
  });
});

describe("spot now", () => {
  it("gives a small summary", async () => {
    await spot(["play", "nf fear"]);

    expect((await spot(["now"])).json).toEqual({
      ok: true,
      active: true,
      isPlaying: true,
      track: {
        name: "FEAR",
        artists: ["NF"],
        album: "Album",
        uri: "spotify:track:fear",
        durationMs: 200000,
        label: "FEAR - NF",
      },
      progressMs: 0,
      device: { id: "d1", name: "Mac", type: "Computer", active: true, volume: 50, restricted: false },
      context: null,
      shuffle: true,
      repeat: "off",
    });
  });

  it("says when nothing is active", async () => {
    spotify.devices = [];

    expect((await spot(["now"])).json).toMatchObject({ ok: true, active: false, track: null });
  });
});

describe("spot playback add", () => {
  it("adds many songs in order", async () => {
    const result = await spot(["playback", "add", "spotify:track:fear", "spotify:track:happy"]);

    expect(result.json).toEqual({ ok: true, action: "queued", added: ["spotify:track:fear", "spotify:track:happy"] });
    expect(spotify.queue).toEqual(["spotify:track:fear", "spotify:track:happy"]);
  });

  it("says what is already in the queue when a later song fails", async () => {
    let posts = 0;
    spotify.intercept = (call) => {
      if (call.method === "POST" && call.path === "/me/player/queue") {
        posts += 1;
        if (posts === 2) {
          return new Response("", { status: 429, headers: { "retry-after": "300" } });
        }
      }

      return undefined;
    };

    const result = await spot(["playback", "add", "spotify:track:fear", "spotify:track:happy"]);

    expect(result.json.error).toMatchObject({
      code: "RATE_LIMITED",
      added: ["spotify:track:fear"],
      notAdded: ["spotify:track:happy"],
    });
  });
});
