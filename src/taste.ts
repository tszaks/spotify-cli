import { SpotError, toErrorPayload } from "./errors.js";
import { getRecentTracks } from "./playback.js";
import { toTrack, type Track } from "./shapes.js";
import { spotifyRequest } from "./spotify-client.js";

type NamedArtist = { name: string; uri: string };

export type Taste = {
  topArtists: { lastMonth: NamedArtist[]; allTime: NamedArtist[] };
  topTracks: { lastMonth: Track[] };
  recentlyPlayed: Track[];
  savedTracks: Track[];
  // Parts that Spotify refused, each with the reason. The other parts are still correct.
  unavailable: Array<{ part: string; code: string; message: string; hint?: string }>;
};

async function topArtists(timeRange: string, limit: number): Promise<NamedArtist[]> {
  const data = await spotifyRequest<{ items?: Array<Record<string, any>> }>("/me/top/artists", {
    searchParams: { time_range: timeRange, limit },
  });

  return (data?.items ?? [])
    .filter((artist) => typeof artist?.name === "string")
    .map((artist) => ({ name: artist.name, uri: artist.uri }));
}

function toTracks(items: Array<Record<string, any> | null | undefined>): Track[] {
  return items.map((item) => toTrack(item)).filter((track): track is Track => track !== null);
}

// One reply with what the user likes. The agent reads this before it selects songs.
export async function getTaste(limit: number): Promise<Taste> {
  const taste: Taste = {
    topArtists: { lastMonth: [], allTime: [] },
    topTracks: { lastMonth: [] },
    recentlyPlayed: [],
    savedTracks: [],
    unavailable: [],
  };

  const parts: Array<[string, () => Promise<void>]> = [
    ["topArtists.lastMonth", async () => {
      taste.topArtists.lastMonth = await topArtists("short_term", limit);
    }],
    ["topArtists.allTime", async () => {
      taste.topArtists.allTime = await topArtists("long_term", limit);
    }],
    ["topTracks.lastMonth", async () => {
      const data = await spotifyRequest<{ items?: Array<Record<string, any>> }>("/me/top/tracks", {
        searchParams: { time_range: "short_term", limit },
      });
      taste.topTracks.lastMonth = toTracks(data?.items ?? []);
    }],
    ["recentlyPlayed", async () => {
      taste.recentlyPlayed = await getRecentTracks(limit);
    }],
    ["savedTracks", async () => {
      const data = await spotifyRequest<{ items?: Array<Record<string, any>> }>("/me/tracks", {
        searchParams: { limit },
      });
      taste.savedTracks = toTracks((data?.items ?? []).map((entry) => entry?.track));
    }],
  ];

  const errors: unknown[] = [];
  await Promise.all(parts.map(async ([part, load]) => {
    try {
      await load();
    } catch (error) {
      errors.push(error);
      const { code, message, hint } = toErrorPayload(error);
      taste.unavailable.push({ part, code, message, hint });
    }
  }));

  // When each part fails, there is no taste data. Report the cause as an error, not as an empty result.
  if (errors.length === parts.length) {
    throw errors[0] instanceof SpotError ? errors[0] : new SpotError("INTERNAL", String(errors[0]));
  }

  taste.unavailable.sort((a, b) => a.part.localeCompare(b.part));
  return taste;
}
