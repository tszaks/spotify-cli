import { SpotError } from "./errors.js";
import { normalize } from "./match.js";
import { type Playlist, toPlaylist, toTrack, type Track } from "./shapes.js";
import { spotifyRequest } from "./spotify-client.js";
import { normalizeSpotifyUri } from "./spotify-uri.js";

const PAGE_SIZE = 50;
const MAX_PLAYLISTS = 1000;
const MAX_TRACKS = 1000;
// Spotify accepts a maximum of 100 items for each playlist write.
const WRITE_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function assertPlaylistItems(uris: string[]): void {
  const bad = uris.filter(
    (uri) => !uri.startsWith("spotify:track:") && !uri.startsWith("spotify:episode:"),
  );

  if (bad.length > 0) {
    throw new SpotError("BAD_INPUT", "A playlist can hold only songs and episodes.", {
      hint: "Remove the albums, artists and playlists from the list.",
      extra: { rejected: bad },
    });
  }
}

export async function listPlaylists(): Promise<Playlist[]> {
  const playlists: Playlist[] = [];

  for (let offset = 0; offset < MAX_PLAYLISTS; offset += PAGE_SIZE) {
    const page = await spotifyRequest<{ items?: Array<Record<string, any> | null>; next?: string | null }>(
      "/me/playlists",
      { searchParams: { limit: PAGE_SIZE, offset } },
    );
    const items = (page?.items ?? []).filter((item): item is Record<string, any> => item !== null);
    playlists.push(...items.map(toPlaylist));

    if (!page?.next || items.length === 0) {
      break;
    }
  }

  return playlists;
}

export function parsePlaylistId(reference: string): string | undefined {
  if (reference.startsWith("spotify:playlist:")) {
    return reference.split(":")[2];
  }

  if (reference.startsWith("https://open.spotify.com/")) {
    const uri = normalizeSpotifyUri(reference);
    return uri.startsWith("spotify:playlist:") ? uri.split(":")[2] : undefined;
  }

  // Spotify ids are 22 letters and digits.
  return /^[A-Za-z0-9]{22}$/.test(reference) ? reference : undefined;
}

// Accepts an id, a URI, a link, or the name of one of the user's own playlists.
export async function resolvePlaylistRef(
  reference: string,
): Promise<{ id: string; uri: string; name?: string }> {
  const id = parsePlaylistId(reference);
  if (id) {
    return { id, uri: `spotify:playlist:${id}` };
  }

  const wanted = normalize(reference);
  const mine = await listPlaylists();
  const exact = mine.filter((playlist) => normalize(playlist.name) === wanted);
  const matches = exact.length > 0
    ? exact
    : mine.filter((playlist) => normalize(playlist.name).includes(wanted));

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new SpotError("NOT_FOUND", `None of your playlists matches "${reference}".`, {
      hint: "Run `spot playlist list` to see the names.",
    });
  }

  throw new SpotError("BAD_INPUT", `More than one playlist matches "${reference}".`, {
    hint: "Use the id of the playlist.",
    extra: { matches: matches.slice(0, 10) },
  });
}

export async function getPlaylistTracks(id: string): Promise<Track[]> {
  const tracks: Track[] = [];

  for (let offset = 0; offset < MAX_TRACKS; offset += PAGE_SIZE) {
    const page = await spotifyRequest<{ items?: Array<Record<string, any> | null>; next?: string | null }>(
      `/playlists/${id}/items`,
      { searchParams: { limit: PAGE_SIZE, offset } },
    );
    const entries = page?.items ?? [];

    for (const entry of entries) {
      // `item` is the name from February 2026. `track` is the old name.
      const track = toTrack(entry?.item ?? entry?.track);
      if (track) {
        tracks.push(track);
      }
    }

    if (!page?.next || entries.length === 0) {
      break;
    }
  }

  return tracks;
}

export async function getPlaylist(reference: string): Promise<Playlist & { tracks: Track[] }> {
  const { id } = await resolvePlaylistRef(reference);
  const raw = await spotifyRequest<Record<string, any>>(`/playlists/${id}`);
  const tracks = await getPlaylistTracks(id);

  return { ...toPlaylist(raw), total: tracks.length, tracks };
}

export async function createPlaylist(options: {
  name: string;
  description?: string;
  isPublic?: boolean;
}): Promise<Playlist> {
  const raw = await spotifyRequest<Record<string, any>>("/me/playlists", {
    method: "POST",
    body: {
      name: options.name,
      // Private by default: a playlist that an agent made must not show on the user's profile.
      public: Boolean(options.isPublic),
      ...(options.description ? { description: options.description } : {}),
    },
  });

  return toPlaylist(raw);
}

export async function addPlaylistItems(id: string, uris: string[]): Promise<void> {
  assertPlaylistItems(uris);

  for (const part of chunk(uris, WRITE_CHUNK)) {
    await spotifyRequest(`/playlists/${id}/items`, {
      method: "POST",
      body: { uris: part },
    });
  }
}

export async function removePlaylistItems(id: string, uris: string[]): Promise<void> {
  for (const part of chunk(uris, WRITE_CHUNK)) {
    await spotifyRequest(`/playlists/${id}/items`, {
      method: "DELETE",
      body: { items: part.map((uri) => ({ uri })) },
    });
  }
}

export async function replacePlaylistItems(id: string, uris: string[]): Promise<void> {
  assertPlaylistItems(uris);
  const [first = [], ...rest] = chunk(uris, WRITE_CHUNK);

  await spotifyRequest(`/playlists/${id}/items`, {
    method: "PUT",
    body: { uris: first },
  });

  for (const part of rest) {
    await spotifyRequest(`/playlists/${id}/items`, {
      method: "POST",
      body: { uris: part },
    });
  }
}

export async function updatePlaylistDetails(
  id: string,
  details: { name?: string; description?: string; isPublic?: boolean },
): Promise<void> {
  const body: Record<string, any> = {};
  if (details.name !== undefined) {
    body.name = details.name;
  }

  if (details.description !== undefined) {
    body.description = details.description;
  }

  if (details.isPublic !== undefined) {
    body.public = details.isPublic;
  }

  if (Object.keys(body).length === 0) {
    throw new SpotError("BAD_INPUT", "Nothing to change.", {
      hint: "Give --name, --description, --public or --private.",
    });
  }

  await spotifyRequest(`/playlists/${id}`, { method: "PUT", body });
}
