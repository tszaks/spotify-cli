import { type DeviceChoice, ensureDevice, getResolvedDeviceId } from "./devices.js";
import { SpotError } from "./errors.js";
import { pickBestMatch } from "./match.js";
import { resolvePlaylistRef } from "./playlists.js";
import { search, type SearchType, searchTracks } from "./search.js";
import { type Device, toDevice, toTrack, type Track } from "./shapes.js";
import { spotifyRequest } from "./spotify-client.js";
import { isContextUri, isQueueableUri, isSpotifyRef, normalizeSpotifyUri } from "./spotify-uri.js";

export type NowPlaying = {
  // False when no Spotify device is in use.
  active: boolean;
  isPlaying: boolean;
  track: Track | null;
  progressMs: number | null;
  device: Device | null;
  context: { type?: string; uri?: string } | null;
  shuffle: boolean | null;
  repeat: string | null;
};

export type PlayTarget = {
  uri: string;
  type: string;
  label?: string;
};

export type PlayResult = {
  action: "resumed" | "playing" | "queued";
  item?: PlayTarget;
  device?: Device;
  woke?: boolean;
};

export async function getNow(): Promise<NowPlaying> {
  const playback = await spotifyRequest<Record<string, any> | undefined>("/me/player");
  if (!playback) {
    return {
      active: false,
      isPlaying: false,
      track: null,
      progressMs: null,
      device: null,
      context: null,
      shuffle: null,
      repeat: null,
    };
  }

  return {
    active: true,
    isPlaying: Boolean(playback.is_playing),
    track: toTrack(playback.item),
    progressMs: playback.progress_ms ?? null,
    device: playback.device ? toDevice(playback.device) : null,
    context: playback.context
      ? { type: playback.context.type, uri: playback.context.uri }
      : null,
    shuffle: playback.shuffle_state ?? null,
    repeat: playback.repeat_state ?? null,
  };
}

// Turns "a URI, a link, or words" into one thing that Spotify can play.
export async function findPlayTarget(
  target: string,
  options: { type?: SearchType; mine?: boolean } = {},
): Promise<PlayTarget> {
  if (isSpotifyRef(target)) {
    const uri = normalizeSpotifyUri(target);
    return { uri, type: uri.split(":")[1] ?? "unknown" };
  }

  const type = options.type ?? "track";

  if (options.mine) {
    const playlist = await resolvePlaylistRef(target);
    return { uri: playlist.uri, type: "playlist", label: playlist.name };
  }

  if (type === "track") {
    const best = pickBestMatch(target, await searchTracks(target));
    if (best) {
      return { uri: best.item.uri, type, label: best.item.label };
    }
  } else {
    const results = await search(target, [type], 1);
    const first = Object.values(results)[0]?.[0];
    if (first) {
      return { uri: first.uri, type, label: first.label };
    }
  }

  throw new SpotError("NOT_FOUND", `Spotify found no ${type} for "${target}".`, {
    hint: "Try different words, or a different --type.",
  });
}

// The device is found first, so a command can stop before it changes the account.
export async function playOn(
  choice: DeviceChoice,
  body: Record<string, any> | undefined,
): Promise<void> {
  await spotifyRequest("/me/player/play", {
    method: "PUT",
    searchParams: { device_id: choice.deviceId },
    body,
  });
}

export async function startPlayback(
  body: Record<string, any> | undefined,
  device: { selector?: string; wake?: boolean },
): Promise<{ device?: Device; woke: boolean }> {
  const choice = await ensureDevice(device);
  await playOn(choice, body);

  return { device: choice.device, woke: choice.woke };
}

export async function play(options: {
  target?: string;
  type?: SearchType;
  mine?: boolean;
  queue?: boolean;
  device?: string;
  wake?: boolean;
  offset?: number;
  positionMs?: number;
}): Promise<PlayResult> {
  const deviceOptions = { selector: options.device, wake: options.wake };

  if (!options.target) {
    if (options.queue) {
      throw new SpotError("BAD_INPUT", "Give a song to add to the queue.");
    }

    const body = options.positionMs === undefined ? undefined : { position_ms: options.positionMs };
    const started = await startPlayback(body, deviceOptions);
    return { action: "resumed", device: started.device, woke: started.woke };
  }

  const item = await findPlayTarget(options.target, options);

  if (options.queue) {
    if (!isQueueableUri(item.uri)) {
      throw new SpotError("BAD_INPUT", "The queue accepts only songs and episodes.", {
        hint: "To play an album, artist or playlist, run the command with no --queue.",
      });
    }

    await spotifyRequest("/me/player/queue", {
      method: "POST",
      searchParams: {
        device_id: await getResolvedDeviceId(options.device),
        uri: item.uri,
      },
    });

    return { action: "queued", item };
  }

  const body: Record<string, any> = {};
  if (isContextUri(item.uri)) {
    body.context_uri = item.uri;
    if (options.offset !== undefined) {
      body.offset = { position: options.offset };
    }
  } else {
    body.uris = [item.uri];
  }

  if (options.positionMs !== undefined) {
    body.position_ms = options.positionMs;
  }

  const started = await startPlayback(body, deviceOptions);
  return { action: "playing", item, device: started.device, woke: started.woke };
}

export async function getRecentTracks(
  limit: number,
  afterMs?: number,
): Promise<Array<Track & { playedAt?: string }>> {
  const data = await spotifyRequest<{ items?: Array<Record<string, any>> }>(
    "/me/player/recently-played",
    { searchParams: { limit, after: afterMs } },
  );

  const tracks: Array<Track & { playedAt?: string }> = [];
  for (const entry of data?.items ?? []) {
    const track = toTrack(entry?.track);
    if (track) {
      tracks.push({ ...track, playedAt: entry.played_at });
    }
  }

  return tracks;
}
