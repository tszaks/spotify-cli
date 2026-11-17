import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { SpotError } from "./errors.js";
import { normalize } from "./match.js";
import { FEELINGS_PATH } from "./paths.js";

// What the user said about a song or an artist. The words of the user are the strongest taste data.
export type FeelingKind = "love" | "meh" | "ban" | "clear";

export type Feeling = {
  at: string;
  kind: FeelingKind;
  // "song" = this song only. "artist" = all songs by these artists.
  scope: "song" | "artist";
  uri?: string;
  name?: string;
  artists: string[];
  why?: string;
  // What played when the user said it, so a remark like "too slow for the gym" keeps its situation.
  device?: string;
};

export async function addFeeling(feeling: Feeling, path = FEELINGS_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(feeling)}\n`, "utf8");
}

export async function readFeelings(path = FEELINGS_PATH): Promise<Feeling[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const feelings: Feeling[] = [];
  for (const line of text.split("\n")) {
    if (line.trim()) {
      try {
        feelings.push(JSON.parse(line) as Feeling);
      } catch {
        continue;
      }
    }
  }

  return feelings;
}

function keyOf(feeling: Pick<Feeling, "scope" | "uri" | "name" | "artists">): string {
  if (feeling.scope === "artist") {
    return `artist:${feeling.artists.map(normalize).sort().join("|")}`;
  }

  return feeling.uri ? `song:${feeling.uri}` : `song:${normalize(feeling.name ?? "")}|${normalize(feeling.artists[0] ?? "")}`;
}

export type FeelingSummary = Omit<Feeling, "kind"> & { kind: Exclude<FeelingKind, "clear"> };

// The latest word wins. "clear" removes the earlier word.
export function currentFeelings(feelings: Feeling[]): FeelingSummary[] {
  const latest = new Map<string, Feeling>();
  for (const feeling of feelings) {
    if (feeling.scope === "artist") {
      // One artist at a time, so "ban Artist A" and "clear Artist A" meet on the same key.
      for (const artist of feeling.artists) {
        latest.set(keyOf({ ...feeling, artists: [artist] }), { ...feeling, artists: [artist] });
      }
    } else {
      latest.set(keyOf(feeling), feeling);
    }
  }

  return [...latest.values()].filter((feeling): feeling is FeelingSummary => feeling.kind !== "clear");
}

export type BanCheck = { uri: string; label?: string; artists?: string[] };

export type BanRule = { scope: "song" | "artist"; label: string; why?: string };

// Returns the ban that stops this song, or null.
export function banFor(song: BanCheck, feelings: FeelingSummary[]): BanRule | null {
  const artists = new Set((song.artists ?? []).map(normalize));

  for (const feeling of feelings) {
    if (feeling.kind !== "ban") {
      continue;
    }

    if (feeling.scope === "song" && feeling.uri && feeling.uri === song.uri) {
      return { scope: "song", label: `${feeling.name ?? feeling.uri}`, why: feeling.why };
    }

    if (feeling.scope === "song" && !feeling.uri && feeling.name && song.label
      && normalize(song.label).startsWith(normalize(feeling.name))
      && feeling.artists.some((artist) => artists.has(normalize(artist)))) {
      return { scope: "song", label: feeling.name, why: feeling.why };
    }

    if (feeling.scope === "artist" && feeling.artists.some((artist) => artists.has(normalize(artist)))) {
      return { scope: "artist", label: feeling.artists.join(", "), why: feeling.why };
    }
  }

  return null;
}

export function assertKind(kind: string): FeelingKind {
  if (kind === "love" || kind === "meh" || kind === "ban" || kind === "clear") {
    return kind;
  }

  throw new SpotError("BAD_INPUT", `Unknown feeling "${kind}".`, {
    hint: "Use love, meh, ban or clear.",
  });
}
