import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ensureDevice } from "./devices.js";
import { SpotError } from "./errors.js";
import { normalize } from "./match.js";
import { DJ_SESSION_PATH } from "./paths.js";
import { getNow, getRecentTracks, playOn } from "./playback.js";
import {
  addPlaylistItems,
  assertPlaylistItems,
  createPlaylist,
  listPlaylists,
  removePlaylistItems,
  replacePlaylistItems,
  updatePlaylistDetails,
} from "./playlists.js";
import { type Device, type Track } from "./shapes.js";
import { spotifyRequest } from "./spotify-client.js";

// A DJ set is a playlist, not the queue: Spotify's queue cannot be cleared or put in a new order.
// One agent turn writes the set and starts it. The music then continues with no agent.
export const DJ_PLAYLIST_NAME = "spot DJ";

export type SetTrack = Pick<Track, "uri" | "label">;

export type DjSession = {
  name: string;
  note?: string;
  startedAt: number;
  endedAt?: number;
  playlistId: string;
  playlistUri: string;
  tracks: SetTrack[];
};

export type DjStatus = {
  session: { name: string; note?: string; startedAt: string; minutes: number; ended: boolean };
  // False when the user moved to different music.
  inSession: boolean;
  isPlaying: boolean;
  current: SetTrack | null;
  played: SetTrack[];
  skipped: SetTrack[];
  remaining: SetTrack[];
  how: string;
};

const SKIP_RULE =
  "Skipped = a song before the current song that Spotify did not record as played. Spotify records a song after 30 seconds of play.";

export async function readSession(): Promise<DjSession | null> {
  try {
    return JSON.parse(await readFile(DJ_SESSION_PATH, "utf8")) as DjSession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeSession(session: DjSession): Promise<void> {
  await mkdir(dirname(DJ_SESSION_PATH), { recursive: true });
  const tempPath = `${DJ_SESSION_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(tempPath, DJ_SESSION_PATH);
}

async function requireSession(): Promise<DjSession> {
  const session = await readSession();
  if (!session) {
    throw new SpotError("NOT_FOUND", "There is no DJ session.", {
      hint: "Run `spot dj start` with a list of songs.",
    });
  }

  return session;
}

function describe(name: string, note?: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return [name, note, `Set made by an agent with spot, ${day}.`].filter(Boolean).join(" · ");
}

// The same playlist is used for each session, so the user's library does not fill with old sets.
async function findOrCreateDjPlaylist(previous: DjSession | null): Promise<{ id: string; uri: string }> {
  const mine = await listPlaylists();
  const known = previous ? mine.find((playlist) => playlist.id === previous.playlistId) : undefined;
  const byName = mine.find((playlist) => playlist.name === DJ_PLAYLIST_NAME);
  const existing = known ?? byName;

  if (existing) {
    return { id: existing.id, uri: existing.uri };
  }

  return createPlaylist({ name: DJ_PLAYLIST_NAME });
}

export async function startSession(options: {
  name: string;
  note?: string;
  tracks: SetTrack[];
  device?: string;
  wake?: boolean;
}): Promise<{ session: DjSession; device?: Device; woke: boolean }> {
  if (options.tracks.length === 0) {
    throw new SpotError("BAD_INPUT", "A DJ set needs one song or more.", {
      hint: "Give songs as arguments or with --from <file>.",
    });
  }

  assertPlaylistItems(options.tracks.map((track) => track.uri));

  // With no device there is no set. Find the device before the playlist is changed.
  const choice = await ensureDevice({ selector: options.device, wake: options.wake });

  const playlist = await findOrCreateDjPlaylist(await readSession());
  await replacePlaylistItems(playlist.id, options.tracks.map((track) => track.uri));
  await updatePlaylistDetails(playlist.id, { description: describe(options.name, options.note) });
  await playOn(choice, { context_uri: playlist.uri, offset: { position: 0 } });

  // The set has an order. Shuffle would break "skipped" and "remaining".
  await spotifyRequest("/me/player/shuffle", {
    method: "PUT",
    searchParams: { state: false },
  }).catch(() => undefined);

  const session: DjSession = {
    name: options.name,
    note: options.note,
    startedAt: Date.now(),
    playlistId: playlist.id,
    playlistUri: playlist.uri,
    tracks: options.tracks,
  };
  await writeSession(session);

  return { session, device: choice.device, woke: choice.woke };
}

// Spotify can play a different copy of a song (a different URI) than the playlist holds.
function songKey(track: { uri: string; label: string }): string {
  return normalize(track.label);
}

export async function getStatus(): Promise<DjStatus> {
  const session = await requireSession();
  const [now, recent] = await Promise.all([
    getNow(),
    getRecentTracks(50, session.startedAt),
  ]);

  const inSession = now.context?.uri === session.playlistUri;
  const currentIndex = inSession && now.track
    ? session.tracks.findIndex(
      (track) => track.uri === now.track?.uri || songKey(track) === songKey(now.track as Track),
    )
    : -1;

  const playedUris = new Set(recent.map((track) => track.uri));
  const playedKeys = new Set(recent.map(songKey));
  const wasPlayed = (track: SetTrack) => playedUris.has(track.uri) || playedKeys.has(songKey(track));

  // With no current position, only songs with a recorded play are sure. The others stay "remaining".
  const before = currentIndex >= 0 ? session.tracks.slice(0, currentIndex) : [];
  const after = currentIndex >= 0
    ? session.tracks.slice(currentIndex + 1)
    : session.tracks.filter((track) => !wasPlayed(track));

  return {
    session: {
      name: session.name,
      note: session.note,
      startedAt: new Date(session.startedAt).toISOString(),
      minutes: Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 60_000),
      ended: session.endedAt !== undefined,
    },
    inSession,
    isPlaying: now.isPlaying,
    current: currentIndex >= 0 ? session.tracks[currentIndex] : null,
    played: currentIndex >= 0 ? before.filter(wasPlayed) : session.tracks.filter(wasPlayed),
    skipped: before.filter((track) => !wasPlayed(track)),
    remaining: after,
    how: SKIP_RULE,
  };
}

// Changes the songs that come next. The current song continues with no break.
export async function steerSession(
  tracks: SetTrack[],
): Promise<{ kept: number; removed: number; added: SetTrack[] }> {
  const session = await requireSession();
  if (tracks.length === 0) {
    throw new SpotError("BAD_INPUT", "Give one song or more for the new direction.");
  }

  const now = await getNow();
  const currentIndex = now.context?.uri === session.playlistUri && now.track
    ? session.tracks.findIndex((track) => track.uri === now.track?.uri)
    : -1;

  if (currentIndex < 0) {
    throw new SpotError("NOT_FOUND", "The DJ set is not playing now.", {
      hint: "Run `spot dj start` to start a new set.",
    });
  }

  const kept = session.tracks.slice(0, currentIndex + 1);
  const keptUris = new Set(kept.map((track) => track.uri));
  // The remove call deletes each copy of a URI, so a song that is also in the kept part must stay.
  const toRemove = session.tracks
    .slice(currentIndex + 1)
    .map((track) => track.uri)
    .filter((uri) => !keptUris.has(uri));
  const added = tracks.filter((track) => !keptUris.has(track.uri));

  if (toRemove.length > 0) {
    await removePlaylistItems(session.playlistId, [...new Set(toRemove)]);
  }

  if (added.length > 0) {
    await addPlaylistItems(session.playlistId, added.map((track) => track.uri));
  }

  await writeSession({ ...session, tracks: [...kept, ...added] });
  return { kept: kept.length, removed: toRemove.length, added };
}

export async function stopSession(): Promise<DjStatus> {
  const session = await requireSession();
  const status = await getStatus();

  if (status.inSession && status.isPlaying) {
    await spotifyRequest("/me/player/pause", { method: "PUT" });
  }

  await writeSession({ ...session, endedAt: session.endedAt ?? Date.now() });
  return {
    ...status,
    isPlaying: status.inSession ? false : status.isPlaying,
    session: { ...status.session, ended: true },
  };
}
