import { beforeEach, describe, expect, it } from "vitest";

import { login, spot } from "./helpers/cli.js";
import { device, FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

const SONGS = "NF - Fear\nDaft Punk - Around the World\nDaft Punk - Midnight Robots From Mars";

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  spotify.catalog = [
    track("fear", "FEAR", "NF"),
    track("world", "Around the World", "Daft Punk"),
    track("robot", "Robot Rock", "Daft Punk"),
  ];
  spotify.devices = [device("d1", "Mac", true)];
  await login();
});

describe("spot playlist create", () => {
  it("makes a private playlist from song names in one command and reports the misses", async () => {
    const result = await spot(
      ["playlist", "create", "Focus", "--description", "Deep work", "--from", "-"],
      { stdin: SONGS },
    );

    const [made] = [...spotify.playlists.values()];
    expect(made).toMatchObject({
      name: "Focus",
      description: "Deep work",
      public: false,
      items: ["spotify:track:fear", "spotify:track:world"],
    });
    expect(result.json).toMatchObject({
      ok: true,
      playlist: { id: made.id, name: "Focus", total: 2, public: false },
      missed: [expect.objectContaining({ input: "Daft Punk - Midnight Robots From Mars" })],
    });
    expect(result.json.added.map((item: any) => item.label)).toEqual(["FEAR - NF", "Around the World - Daft Punk"]);
  });

  it("makes no playlist when none of the songs is found", async () => {
    const result = await spot(["playlist", "create", "Ghost", "Zzzz - Qqqq", "Xxxx - Yyyy"]);

    expect(result.code).toBe(5);
    expect(result.json.error).toMatchObject({ code: "NOT_FOUND", missed: [expect.anything(), expect.anything()] });
    expect(spotify.playlists.size).toBe(0);
  });

  it("makes an empty playlist when no songs are given", async () => {
    const result = await spot(["playlist", "create", "Empty"]);

    expect(result.json.playlist).toMatchObject({ name: "Empty", total: 0 });
  });

  it("is public only with --public", async () => {
    await spot(["playlist", "create", "Party", "NF - Fear", "--public"]);

    expect([...spotify.playlists.values()][0].public).toBe(true);
  });

  it("starts the playlist with --play", async () => {
    const result = await spot(["playlist", "create", "Focus", "NF - Fear", "--play"]);

    const [made] = [...spotify.playlists.values()];
    expect(result.json.playing).toMatchObject({ action: "playing", device: { name: "Mac" } });
    expect(spotify.player?.context_uri).toBe(`spotify:playlist:${made.id}`);
  });

  it("makes no playlist with --play when no device can play", async () => {
    spotify.devices = [];

    const result = await spot(["playlist", "create", "Focus", "NF - Fear", "--play"]);

    expect(result.json.error.code).toBe("NO_ACTIVE_DEVICE");
    expect(spotify.playlists.size).toBe(0);
  });

  it("says that the playlist exists when only the start fails", async () => {
    spotify.intercept = (call) =>
      call.path === "/me/player/play"
        ? new Response("", { status: 429, headers: { "retry-after": "300" } })
        : undefined;

    const result = await spot(["playlist", "create", "Focus", "NF - Fear", "--play"]);

    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({
      ok: true,
      playlist: { name: "Focus", total: 1 },
      playing: null,
      playError: { code: "RATE_LIMITED", retryAfterSeconds: 300 },
    });
    expect(spotify.playlists.size).toBe(1);
  });

  it("writes more than 100 songs in parts of 100", async () => {
    spotify.catalog = Array.from({ length: 230 }, (_, index) => track(`t${index}`, `Song ${index}`, "Band"));
    const uris = spotify.catalog.map((item) => item.uri);

    const result = await spot(["playlist", "create", "Big", "--from", "-"], { stdin: uris.join("\n") });

    expect(result.json.playlist.total).toBe(230);
    expect([...spotify.playlists.values()][0].items).toEqual(uris);
    expect(spotify.callsTo("POST", /\/items$/).map((call) => call.body.uris.length)).toEqual([100, 100, 30]);
  });

  it("makes no playlist when the list has an album in it", async () => {
    const result = await spot(["playlist", "create", "Mix", "NF - Fear", "spotify:album:abc"]);

    expect(result.json.error).toMatchObject({ code: "BAD_INPUT", rejected: ["spotify:album:abc"] });
    expect(spotify.playlists.size).toBe(0);
  });

  it("refuses an album in the song list and makes no change", async () => {
    const playlist = spotify.addPlaylist("Mix");

    const result = await spot(["playlist", "add", "Mix", "spotify:album:abc"]);

    expect(result.json.error).toMatchObject({ code: "BAD_INPUT", rejected: ["spotify:album:abc"] });
    expect(playlist.items).toEqual([]);
  });
});

describe("playlist by name", () => {
  it("finds the user's playlist by name, with any case", async () => {
    const playlist = spotify.addPlaylist("Road Trip", ["spotify:track:fear"]);

    const result = await spot(["playlist", "add", "road trip", "Daft Punk - Around the World"]);

    expect(result.json.ok).toBe(true);
    expect(playlist.items).toEqual(["spotify:track:fear", "spotify:track:world"]);
  });

  it("prefers the exact name over a longer name", async () => {
    spotify.addPlaylist("Road Trip 2025");
    const exact = spotify.addPlaylist("Road Trip");

    const result = await spot(["playlist", "show", "Road Trip"]);

    expect(result.json.id).toBe(exact.id);
  });

  it("does not guess between two playlists, and lists them", async () => {
    spotify.addPlaylist("Road Trip 2024");
    spotify.addPlaylist("Road Trip 2025");

    const result = await spot(["playlist", "add", "road trip", "NF - Fear"]);

    expect(result.code).toBe(2);
    expect(result.json.error.matches.map((item: any) => item.name)).toEqual(["Road Trip 2024", "Road Trip 2025"]);
  });

  it("reports a name that matches nothing", async () => {
    const result = await spot(["playlist", "show", "Nope"]);

    expect(result.json.error).toMatchObject({ code: "NOT_FOUND", hint: expect.stringContaining("spot playlist list") });
  });

  it("finds a playlist that is after the first page of 50", async () => {
    for (let index = 0; index < 60; index += 1) {
      spotify.addPlaylist(`List ${index}`);
    }

    const target = spotify.addPlaylist("Last One");

    expect((await spot(["playlist", "show", "last one"])).json.id).toBe(target.id);
    expect((await spot(["playlist", "list"])).json.playlists).toHaveLength(61);
  });
});

describe("playlist changes", () => {
  it("shows a playlist with all its songs", async () => {
    spotify.catalog = Array.from({ length: 120 }, (_, index) => track(`t${index}`, `Song ${index}`, "Band"));
    const playlist = spotify.addPlaylist("Long", spotify.catalog.map((item) => item.uri));

    const result = await spot(["playlist", "show", `spotify:playlist:${playlist.id}`]);

    expect(result.json).toMatchObject({ name: "Long", total: 120, owner: "Tester" });
    expect(result.json.tracks).toHaveLength(120);
    expect(result.json.tracks[119].label).toBe("Song 119 - Band");
  });

  it("replaces all songs", async () => {
    const playlist = spotify.addPlaylist("Mix", ["spotify:track:robot"]);

    await spot(["playlist", "replace", "Mix", "NF - Fear", "Daft Punk - Around the World"]);

    expect(playlist.items).toEqual(["spotify:track:fear", "spotify:track:world"]);
  });

  it("removes songs by URI or link", async () => {
    const playlist = spotify.addPlaylist("Mix", ["spotify:track:fear", "spotify:track:world", "spotify:track:robot"]);

    const result = await spot(["playlist", "remove", "Mix", "spotify:track:fear", "https://open.spotify.com/track/robot"]);

    expect(result.json.removed).toEqual(["spotify:track:fear", "spotify:track:robot"]);
    expect(playlist.items).toEqual(["spotify:track:world"]);
  });

  it("changes the name and description", async () => {
    const playlist = spotify.addPlaylist("Mix");

    await spot(["playlist", "update", "Mix", "--name", "Mix 2", "--description", "New"]);

    expect(playlist).toMatchObject({ name: "Mix 2", description: "New" });
  });

  it("asks what to change when update has no option", async () => {
    spotify.addPlaylist("Mix");

    expect((await spot(["playlist", "update", "Mix"])).json.error.code).toBe("BAD_INPUT");
  });
});
