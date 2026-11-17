import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { banFor, currentFeelings, type Feeling } from "../src/feelings.js";
import { type ListenEvent, readEvents } from "../src/listening.js";
import {
  FEELINGS_PATH,
  LISTENING_PATH,
  TASTE_NOTES_PATH,
  WATCH_LOCK_PATH,
  WATCH_STATE_PATH,
} from "../src/paths.js";
import type { NowPlaying } from "../src/playback.js";
import { insertNote, NOTES_TEMPLATE, weeklyScore } from "../src/profile.js";
import { emptyState, launchAgentPlist, observe, stableNodePath, takeWatchLock } from "../src/watch.js";
import { launchctlCalls, login, logout, spot } from "./helpers/cli.js";
import { launchAgentPath } from "../src/watch.js";
import { device, FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;
const uri = (name: string) => `spotify:track:${name}`;

beforeEach(async () => {
  await logout();
  for (const path of [LISTENING_PATH, FEELINGS_PATH, TASTE_NOTES_PATH, WATCH_STATE_PATH, WATCH_LOCK_PATH]) {
    await rm(path, { force: true });
  }

  spotify = new FakeSpotify().install();
  spotify.catalog = [
    track("one", "One", "Band"),
    track("two", "Two", "Band"),
    track("three", "Three", "Other"),
    track("live", "Song (Live)", "Loud"),
  ];
  spotify.devices = [device("d1", "iPhone", true, "Smartphone")];
  await login();
});

function playing(id: string, progressMs: number, extra: Partial<NowPlaying> = {}): NowPlaying {
  return {
    active: true,
    isPlaying: true,
    track: { uri: uri(id), name: id, artists: ["Band"], durationMs: 200_000, label: `${id} - Band` },
    progressMs,
    device: { id: "d1", name: "iPhone", type: "Smartphone", active: true, volume: 50, restricted: false },
    context: { type: "playlist", uri: "spotify:playlist:dj" },
    shuffle: false,
    repeat: "off",
    ...extra,
  };
}

const NOTHING: NowPlaying = {
  active: false, isPlaying: false, track: null, progressMs: null, device: null, context: null, shuffle: null, repeat: null,
};

describe("the watcher rules (observe)", () => {
  const dj = { playlistUri: "spotify:playlist:dj", name: "Focus", note: "no vocals", ended: false };

  it("records a skip, with the seconds played before the next song started", () => {
    let state = observe(emptyState(), playing("a", 1_000), 0, dj).state;
    state = observe(state, playing("a", 21_000), 20_000, dj).state;
    // 20 s later a new song is at 5 s: the old song played to about 21 + 15 = 36 s.
    const result = observe(state, playing("b", 5_000), 40_000, dj);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      uri: uri("a"), ended: "skipped", playedMs: 36_000, by: "dj", set: "Focus", note: "no vocals",
      device: "iPhone", deviceType: "Smartphone", source: "watch",
    });
    expect(result.state.current?.uri).toBe(uri("b"));
  });

  it("records a song that played to its end as finished", () => {
    let state = observe(emptyState(), playing("a", 180_000), 0, dj).state;
    const result = observe(state, playing("b", 3_000), 20_000, dj);
    expect(result.events[0]).toMatchObject({ ended: "finished", playedMs: 197_000 });
    state = result.state;
    expect(state.recorded).toBe(1);
  });

  it("records a paused song that is replaced as stopped, not skipped, with no paused time", () => {
    let state = observe(emptyState(), playing("a", 10_000, { isPlaying: false }), 0, dj).state;
    state = observe(state, playing("a", 10_000, { isPlaying: false }), 600_000, dj).state;
    const result = observe(state, playing("b", 2_000), 620_000, dj);
    expect(result.events[0]).toMatchObject({ ended: "stopped", playedMs: 10_000 });
  });

  it("does not count a gap with no polls (sleep, no network) as listening", () => {
    const state = observe(emptyState(), playing("a", 10_000), 0, dj).state;
    // 20 minutes later a different song plays. Nobody saw how "a" ended.
    const result = observe(state, playing("b", 30_000), 1_200_000, dj);
    expect(result.events[0]).toMatchObject({ ended: "stopped", playedMs: 10_000 });
  });

  it("records 'stopped' when the music stops: that is not a skip", () => {
    const state = observe(emptyState(), playing("a", 50_000), 0, dj).state;
    const result = observe(state, NOTHING, 20_000, dj);
    expect(result.events[0]).toMatchObject({ ended: "stopped", playedMs: 50_000 });
    expect(result.state.current).toBeNull();
  });

  it("records a song that starts again (repeat) as one play", () => {
    const state = observe(emptyState(), playing("a", 195_000), 0, dj).state;
    const result = observe(state, playing("a", 4_000), 20_000, dj);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].ended).toBe("finished");
    expect(result.state.current?.progressMs).toBe(4_000);
  });

  it("marks songs from other music as the user's own, and an ended set as not the agent's", () => {
    const own = observe(emptyState(), playing("a", 0, { context: { type: "album", uri: "spotify:album:x" } }), 0, dj);
    expect(own.state.current?.by).toBe("you");

    const ended = observe(emptyState(), playing("a", 0), 0, { ...dj, ended: true });
    expect(ended.state.current?.by).toBe("you");
  });

  it("ignores podcast episodes", () => {
    const episode = playing("a", 0);
    episode.track = { ...episode.track!, uri: "spotify:episode:x" };
    expect(observe(emptyState(), episode, 0, dj).state.current).toBeNull();
  });
});

describe("spot watch run --once", () => {
  it("writes one line to the listening log when the song changes", async () => {
    spotify.player = { item: spotify.find(uri("one")), is_playing: true, shuffle: false, repeat: "off", progress_ms: 2_000 };
    const first = await spot(["watch", "run", "--once"]);
    expect(first.json).toMatchObject({ ok: true, recorded: [] });

    spotify.player.item = spotify.find(uri("two"));
    spotify.player.progress_ms = 1_000;
    const second = await spot(["watch", "run", "--once"]);

    expect(second.json.recorded).toHaveLength(1);
    expect(second.json.recorded[0]).toMatchObject({ name: "One", artists: ["Band"], ended: "skipped", by: "you" });
    expect(await readEvents()).toHaveLength(1);

    const status = await spot(["watch", "status"]);
    expect(status.json).toMatchObject({ ok: true, recorded: 1, current: "Two - Band", running: false });
  });

  it("keeps the error and does not crash when the login is gone", async () => {
    await logout();
    const result = await spot(["watch", "run", "--once"]);
    expect(result.json).toMatchObject({ ok: true, recorded: [], lastError: { code: "NOT_LOGGED_IN" } });
  });

  it("allows only one watcher at a time", async () => {
    const release = await takeWatchLock();
    await expect(takeWatchLock()).rejects.toMatchObject({ code: "BAD_INPUT" });
    await release();

    // A lock left by a process that ended is taken over.
    await writeFile(WATCH_LOCK_PATH, "99999999");
    const again = await takeWatchLock();
    await again();
  });
});

describe("spot feel and the bans", () => {
  it("bans the song that plays now, and a DJ set then leaves it out", async () => {
    spotify.player = { item: spotify.find(uri("two")), is_playing: true, shuffle: false, repeat: "off", progress_ms: 0 };
    const feel = await spot(["feel", "ban", "--why", "too slow"]);
    expect(feel.json).toMatchObject({ ok: true, feeling: { kind: "ban", scope: "song", uri: uri("two"), why: "too slow", device: "iPhone" } });

    const set = await spot(["dj", "start", "Band - One", "Band - Two", "Other - Three"]);
    expect(set.json.tracks.map((item: any) => item.uri)).toEqual([uri("one"), uri("three")]);
    expect(set.json.blocked).toEqual([
      expect.objectContaining({ uri: uri("two"), ban: { scope: "song", label: "Two", why: "too slow" } }),
    ]);
  });

  it("bans an artist by name, and keeps a banned song with --include-banned", async () => {
    await spot(["feel", "ban", "--artist", "Loud - Song (Live)"]);

    const blocked = await spot(["playlist", "create", "Mix", "Band - One", "Loud - Song (Live)"]);
    expect(blocked.json.added.map((item: any) => item.uri)).toEqual([uri("one")]);
    expect(blocked.json.blocked[0].ban).toMatchObject({ scope: "artist", label: "Loud" });

    const kept = await spot(["playlist", "create", "Mix 2", "Loud - Song (Live)", "--include-banned"]);
    expect(kept.json.added.map((item: any) => item.uri)).toEqual([uri("live")]);
  });

  it("finds the artist of a URI input when an artist is banned", async () => {
    await spot(["feel", "ban", "--artist", "Loud - Song (Live)"]);
    const set = await spot(["dj", "start", "spotify:track:live", "https://open.spotify.com/track/one"]);
    expect(set.json.tracks.map((item: any) => item.uri)).toEqual([uri("one")]);
    expect(set.json.blocked[0]).toMatchObject({ uri: uri("live"), ban: { scope: "artist", label: "Loud" } });
  });

  it("forgets a ban after clear", async () => {
    await spot(["feel", "ban", "Band - One"]);
    await spot(["feel", "clear", "Band - One"]);
    const set = await spot(["dj", "start", "Band - One"]);
    expect(set.json).toMatchObject({ ok: true, blocked: [] });
  });

  it("stops with a clear error when each song is banned", async () => {
    await spot(["feel", "ban", "Band - One"]);
    const set = await spot(["dj", "start", "Band - One"]);
    expect(set.code).toBe(5);
    expect(set.json.error).toMatchObject({ code: "NOT_FOUND", message: "Each song found is banned by the user." });
    expect(spotify.playlists.size).toBe(0);
  });

  it("rejects an unknown feeling and needs a song when nothing plays", async () => {
    expect((await spot(["feel", "hate", "Band - One"])).json.error.code).toBe("BAD_INPUT");
    expect((await spot(["feel", "love"])).json.error.code).toBe("NOT_FOUND");
  });

  it("uses the latest word for each song or artist", () => {
    const at = "2026-11-01T00:00:00Z";
    const feelings: Feeling[] = [
      { at, kind: "ban", scope: "artist", artists: ["A", "B"] },
      { at, kind: "clear", scope: "artist", artists: ["A"] },
      { at, kind: "love", scope: "song", uri: uri("x"), name: "X", artists: ["C"] },
    ];
    const now = currentFeelings(feelings);
    expect(banFor({ uri: uri("y"), artists: ["A"] }, now)).toBeNull();
    expect(banFor({ uri: uri("y"), artists: ["b"] }, now)).toMatchObject({ scope: "artist", label: "B" });
    expect(now.filter((item) => item.kind === "love")).toHaveLength(1);
  });
});

describe("spot history import", () => {
  async function exportFolder(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "spot-export-"));
    await mkdir(join(folder, "Spotify Extended Streaming History"));
    await writeFile(join(folder, "Spotify Extended Streaming History", "Streaming_History_Audio_2024.json"), JSON.stringify([
      { ts: "2024-03-01T08:00:00Z", ms_played: 200_000, master_metadata_track_name: "One", master_metadata_album_artist_name: "Band", spotify_track_uri: uri("one"), reason_end: "trackdone", skipped: false, platform: "ios" },
      { ts: "2024-03-01T08:01:00Z", ms_played: 4_000, master_metadata_track_name: "Two", master_metadata_album_artist_name: "Band", spotify_track_uri: uri("two"), reason_end: "fwdbtn", skipped: true, platform: "ios" },
      { ts: "2024-03-01T08:02:00Z", ms_played: 60_000, master_metadata_track_name: null, episode_name: "A podcast" },
    ]));
    await writeFile(join(folder, "Spotify Extended Streaming History", "ReadMeFirst.pdf"), "not json");
    await writeFile(join(folder, "StreamingHistory_music_0.json"), JSON.stringify([
      { endTime: "2025-01-02 21:30", artistName: "Other", trackName: "Three", msPlayed: 12_000 },
    ]));
    return folder;
  }

  it("imports both kinds of download, and a second run adds nothing", async () => {
    const folder = await exportFolder();
    const first = await spot(["history", "import", folder]);
    expect(first.json).toMatchObject({ ok: true, added: 3, alreadyImported: 0, skippedRows: 1, from: "2024-03-01T08:00:00.000Z" });

    const events = await readEvents();
    expect(events.map((event) => [event.name, event.ended])).toEqual([
      ["One", "finished"], ["Two", "skipped"], ["Three", "skipped"],
    ]);
    expect(events[0]).toMatchObject({ uri: uri("one"), by: "you", device: "ios", source: "import" });

    const second = await spot(["history", "import", folder]);
    expect(second.json).toMatchObject({ added: 0, alreadyImported: 3 });
  });

  it("says what to do when there are no history files", async () => {
    const empty = await mkdtemp(join(tmpdir(), "spot-empty-"));
    const result = await spot(["history", "import", empty]);
    expect(result.json.error).toMatchObject({ code: "NOT_FOUND" });
    expect(result.json.error.hint).toContain("Unzip");
  });
});

function event(name: string, ended: ListenEvent["ended"], at: string, extra: Partial<ListenEvent> = {}): ListenEvent {
  return { at, uri: uri(name), name, artists: ["Band"], playedMs: ended === "skipped" ? 5_000 : 200_000, ended, by: "you", source: "watch", ...extra };
}

describe("spot taste profile, note and score", () => {
  it("gives notes, the user's words, favourites, quick skips and the score in one reply", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const lines: ListenEvent[] = [
      ...Array.from({ length: 6 }, (_, i) => event("one", "finished", day(10 + i), { device: "iPhone" })),
      ...Array.from({ length: 6 }, (_, i) => event("noise", "skipped", day(10 + i), { artists: ["Loud"], device: "iPhone" })),
      event("two", "finished", day(2), { by: "dj", set: "Focus" }),
      event("three", "skipped", day(2), { by: "dj", set: "Focus" }),
    ];
    await writeFile(LISTENING_PATH, lines.map((line) => JSON.stringify(line)).join("\n"));
    await spot(["feel", "love", "Band - One", "--why", "a classic"]);
    await spot(["taste", "note", "No vocals when working"]);

    const result = await spot(["taste", "profile"]);
    const profile = result.json;

    expect(profile.ok).toBe(true);
    expect(profile.notes.text).toContain("- No vocals when working");
    expect(profile.said.loved[0]).toMatchObject({ name: "One", why: "a classic" });
    expect(profile.favourites.artistsRecent[0]).toMatchObject({ name: "Band", plays: 8 });
    expect(profile.favourites.songs[0]).toMatchObject({ name: "one - Band", plays: 6, skipRate: 0 });
    expect(profile.oftenSkipped.artists[0]).toMatchObject({ name: "Loud", skipRate: 1 });
    expect(profile.oftenSkipped.songs[0]).toMatchObject({ name: "noise - Loud", skipped: 6 });
    expect(profile.devices[0]).toMatchObject({ device: "iPhone", plays: 12 });
    expect(profile.lastSets[0]).toMatchObject({ set: "Focus", played: 1, skipped: ["three - Band"] });
    expect(profile.data).toMatchObject({ events: 14, djSongs: 2 });
    expect(profile.score.at(-1).dj).toMatchObject({ plays: 2, skipRate: 0.5 });
  });

  it("keeps the score of new songs and known songs apart", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const score = weeklyScore([
      event("a", "finished", "2026-11-05T00:00:00Z"),
      event("a", "finished", "2026-11-15T00:00:00Z", { by: "dj" }),
      event("b", "skipped", "2026-11-15T00:01:00Z", { by: "dj" }),
      event("c", "stopped", "2026-11-15T00:02:00Z", { by: "dj" }),
    ], 2, now);

    expect(score[1].dj).toMatchObject({ plays: 3, skipped: 1, skipRate: 0.5 });
    expect(score[1].dj.knownSongs).toMatchObject({ plays: 1, skipRate: 0 });
    expect(score[1].dj.newSongs).toMatchObject({ plays: 2, skipRate: 1 });
    expect(score[0].you).toMatchObject({ plays: 1, skipRate: 0 });
  });

  it("adds a note at the end of its section, and adds a missing section", () => {
    const one = insertNote(NOTES_TEMPLATE, "Situations", "Gym: fast songs", "2026-11-16");
    expect(one).toContain("## Situations\n\n- Gym: fast songs (2026-11-16)\n\n## Agent notes");
    const two = insertNote(one, "situations", "Patio: soul", "2026-11-17");
    expect(two).toContain("- Gym: fast songs (2026-11-16)\n- Patio: soul (2026-11-17)\n");
    const three = insertNote(two, "Car", "Loud", "2026-11-17");
    expect(three.endsWith("## Car\n\n- Loud (2026-11-17)\n")).toBe(true);
  });

  it("dj stop tells the agent how to keep what it learned", async () => {
    await spot(["dj", "start", "Band - One"]);
    const stop = await spot(["dj", "stop"]);
    expect(stop.json.learn).toContain("spot taste note");
  });

  it("keeps both notes when two agents write at the same time", async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => spot(["taste", "note", `Lesson ${i}`])));
    const text = await readFile(TASTE_NOTES_PATH, "utf8");
    for (let i = 0; i < 5; i += 1) {
      expect(text).toContain(`- Lesson ${i} (`);
    }
  });

  it("counts an imported play and a watched play of one song as the same song", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const score = weeklyScore([
      { ...event("Song", "finished", "2026-11-10T00:00:00Z"), uri: undefined, source: "import" },
      event("Song (Remastered 2011)", "finished", "2026-11-15T00:00:00Z", { by: "dj" }),
    ], 1, now);
    expect(score[0].dj.knownSongs.plays).toBe(1);
  });

  it("spot taste score gives one row for each week", async () => {
    await writeFile(LISTENING_PATH, `${JSON.stringify(event("a", "skipped", new Date(Date.now() - 60_000).toISOString(), { by: "dj" }))}\n`);
    const result = await spot(["taste", "score", "--weeks", "3"]);
    expect(result.json.score).toHaveLength(3);
    expect(result.json.score[2].dj).toMatchObject({ plays: 1, skipRate: 1 });
    expect((await spot(["taste", "score", "--weeks", "0"])).json.error.code).toBe("BAD_INPUT");
  });

  it("keeps notes that the user wrote by hand", async () => {
    await writeFile(TASTE_NOTES_PATH, "# My notes\n\nI like it loud.\n");
    await spot(["taste", "note", "Test"]);
    const text = await readFile(TASTE_NOTES_PATH, "utf8");
    expect(text).toContain("I like it loud.");
    expect(text).toContain("## Agent notes (not confirmed)\n\n- Test (");
  });
});

describe("launchd file", () => {
  it("runs `watch run` with the node of this process and escapes paths", () => {
    const plist = launchAgentPlist("/usr/local/bin/node", "/a&b/dist/index.js", { SPOT_OUTPUT: "json" });
    expect(plist).toContain("<string>/a&amp;b/dist/index.js</string>");
    expect(plist).toContain("<string>watch</string>\n    <string>run</string>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
  });
});

describe("watch run --once and a running watcher", () => {
  it("refuses to poll while a different watcher holds the lock", async () => {
    const release = await takeWatchLock();
    const result = await spot(["watch", "run", "--once"]);
    await release();
    expect(result.json.error).toMatchObject({ code: "BAD_INPUT" });
    expect(result.json.error.hint).toContain("spot watch status");
  });
});

describe("spot watch install and uninstall", () => {
  it.runIf(process.platform === "darwin")("writes the launchd file and starts it, then removes it", async () => {
    launchctlCalls.length = 0;
    const installed = await spot(["watch", "install"]);
    expect(installed.json).toMatchObject({ ok: true, path: launchAgentPath(), loaded: true });
    expect(await readFile(launchAgentPath(), "utf8")).toContain("<string>watch</string>");
    expect(launchctlCalls.map((args) => args[0])).toEqual(["bootout", "bootstrap"]);
    expect((await spot(["watch", "status"])).json.installed).toBe(true);

    const removed = await spot(["watch", "uninstall"]);
    expect(removed.json).toMatchObject({ ok: true, removed: true });
    expect((await spot(["watch", "status"])).json.installed).toBe(false);
  });

  it.runIf(process.platform !== "darwin")("says that install works only on macOS", async () => {
    expect((await spot(["watch", "install"])).json.error.code).toBe("BAD_INPUT");
  });
});

describe("stableNodePath", () => {
  it("uses a PATH link to the same Node, so an upgrade does not break the watcher", async () => {
    const { symlink } = await import("node:fs/promises");
    const cellar = await mkdtemp(join(tmpdir(), "spot-cellar-"));
    const bin = await mkdtemp(join(tmpdir(), "spot-bin-"));
    const other = await mkdtemp(join(tmpdir(), "spot-other-"));
    await writeFile(join(cellar, "node"), "");
    await writeFile(join(other, "node"), "");
    await symlink(join(cellar, "node"), join(bin, "node"));

    expect(await stableNodePath(join(cellar, "node"), [other, bin].join(":"))).toBe(join(bin, "node"));
    expect(await stableNodePath(join(cellar, "node"), other)).toBe(join(cellar, "node"));
  });
});
