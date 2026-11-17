import { type Confidence, pickBestMatch } from "./match.js";
import { searchTracks } from "./search.js";
import { isSpotifyRef, normalizeSpotifyUri } from "./spotify-uri.js";

// A small pool keeps a 30-song list fast and does not use up the shared Spotify quota.
const POOL_SIZE = 4;

export type ResolvedItem = {
  input: string;
  uri: string;
  name?: string;
  artists?: string[];
  label?: string;
  // "exact" means the input was already a Spotify URI or link.
  confidence: Confidence | "exact";
};

export type MissedItem = {
  input: string;
  reason: string;
  closest?: { label: string; uri: string };
};

export type ResolveResult = {
  resolved: ResolvedItem[];
  missed: MissedItem[];
  duplicatesRemoved: number;
};

// One song for each line. Accepts list marks ("1. ", "- ") and skips empty lines and # comments.
export function parseNameLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function mapPool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function simplify(input: string): string {
  return input
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+[-–—]\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveOne(input: string, loose: boolean): Promise<ResolvedItem | MissedItem> {
  if (isSpotifyRef(input)) {
    return { input, uri: normalizeSpotifyUri(input), confidence: "exact" };
  }

  let best = pickBestMatch(input, await searchTracks(input));

  // "Artist - Title (Live)" can confuse the search. One more try with the plain words.
  const simpler = simplify(input);
  if ((!best || best.match.confidence === "low") && simpler && simpler !== input) {
    const second = pickBestMatch(input, await searchTracks(simpler));
    if (second && (!best || second.match.score > best.match.score)) {
      best = second;
    }
  }

  if (!best) {
    return { input, reason: "Spotify found no song for this text." };
  }

  const { item, match } = best;
  if (match.confidence === "low" && !loose) {
    return {
      input,
      reason: "No result has this title and artist. The song is possibly not real, or the name is wrong.",
      closest: { label: item.label, uri: item.uri },
    };
  }

  return {
    input,
    uri: item.uri,
    name: item.name,
    artists: item.artists,
    label: item.label,
    confidence: match.confidence,
  };
}

export async function resolveNames(
  inputs: string[],
  options: { loose?: boolean } = {},
): Promise<ResolveResult> {
  const outcomes = await mapPool(inputs, POOL_SIZE, (input) =>
    resolveOne(input, Boolean(options.loose)));

  const resolved: ResolvedItem[] = [];
  const missed: MissedItem[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const outcome of outcomes) {
    if (!("uri" in outcome)) {
      missed.push(outcome);
    } else if (seen.has(outcome.uri)) {
      duplicatesRemoved += 1;
    } else {
      seen.add(outcome.uri);
      resolved.push(outcome);
    }
  }

  return { resolved, missed, duplicatesRemoved };
}
