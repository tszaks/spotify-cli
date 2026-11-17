import { SpotError } from "./errors.js";
import { formatSearchItemSummary } from "./output.js";
import { toTrack, type Track } from "./shapes.js";
import { spotifyRequest } from "./spotify-client.js";

export const SEARCH_TYPES = [
  "track",
  "album",
  "artist",
  "playlist",
  "show",
  "episode",
  "audiobook",
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchItem = {
  type: string;
  name: string;
  uri: string;
  artists?: string[];
  owner?: string;
  label: string;
};

export function parseSearchTypes(value: string): SearchType[] {
  const types = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const unknown = types.filter((type) => !SEARCH_TYPES.includes(type as SearchType));
  if (types.length === 0 || unknown.length > 0) {
    throw new SpotError("BAD_INPUT", `Unknown search type: ${unknown.join(", ") || value}.`, {
      hint: `Use one or more of: ${SEARCH_TYPES.join(", ")}.`,
    });
  }

  return types as SearchType[];
}

function toSearchItem(type: string, raw: Record<string, any> | null): SearchItem | null {
  if (!raw || typeof raw.uri !== "string") {
    return null;
  }

  const artists: string[] | undefined = Array.isArray(raw.artists)
    ? raw.artists
      .map((artist: { name?: unknown }) => artist?.name)
      .filter((name: unknown): name is string => typeof name === "string")
    : undefined;

  return {
    type,
    name: raw.name ?? "Unknown",
    uri: raw.uri,
    artists: artists && artists.length > 0 ? artists : undefined,
    owner: raw.owner?.display_name,
    label: formatSearchItemSummary(raw),
  };
}

// Result keys are plural ("tracks"), as Spotify sends them.
export async function search(
  query: string,
  types: SearchType[],
  limit: number,
): Promise<Record<string, SearchItem[]>> {
  const data = await spotifyRequest<Record<string, { items?: Array<Record<string, any> | null> }>>(
    "/search",
    {
      searchParams: {
        q: query,
        type: types.join(","),
        limit,
      },
    },
  );

  const results: Record<string, SearchItem[]> = {};
  for (const [key, payload] of Object.entries(data ?? {})) {
    const type = key.replace(/s$/, "");
    results[key] = (payload?.items ?? [])
      .map((item) => toSearchItem(type, item))
      .filter((item): item is SearchItem => item !== null);
  }

  return results;
}

export async function searchTracks(query: string, limit = 5): Promise<Track[]> {
  const data = await spotifyRequest<{ tracks?: { items?: Array<Record<string, any> | null> } }>(
    "/search",
    {
      searchParams: {
        q: query,
        type: "track",
        limit,
      },
    },
  );

  return (data?.tracks?.items ?? [])
    .map((item) => toTrack(item))
    .filter((track): track is Track => track !== null);
}
