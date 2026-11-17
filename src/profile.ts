import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { currentFeelings, type FeelingSummary, readFeelings } from "./feelings.js";
import { type ListenEvent, readEvents } from "./listening.js";
import { normalize } from "./match.js";
import { TASTE_NOTES_PATH } from "./paths.js";

// ---------- The taste notes file ----------

export const NOTES_TEMPLATE = `# Taste notes

Agents read this file before each DJ set. You can change it at any time. Your words win.

## Rules you said

## Situations

## Agent notes (not confirmed)
`;

export const DEFAULT_SECTION = "Agent notes (not confirmed)";

export async function readNotes(path = TASTE_NOTES_PATH): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

// Adds one dated line at the end of a section. A section that does not exist is added at the end.
export function insertNote(file: string, section: string, text: string, day: string): string {
  const line = `- ${text.replace(/\s+/g, " ").trim()} (${day})`;
  const lines = file.replace(/\n+$/, "").split("\n");
  const heading = lines.findIndex((item) => /^##\s+/.test(item) && normalize(item.replace(/^##\s+/, "")) === normalize(section));

  if (heading === -1) {
    return `${lines.join("\n")}\n\n## ${section}\n\n${line}\n`;
  }

  let end = lines.length;
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  // After the last line of the section that has text.
  let at = end;
  while (at > heading + 1 && lines[at - 1].trim() === "") {
    at -= 1;
  }

  if (at === heading + 1) {
    lines.splice(at, 0, "", line);
  } else {
    lines.splice(at, 0, line);
  }

  return `${lines.join("\n")}\n`;
}

export async function addNote(text: string, section = DEFAULT_SECTION, path = TASTE_NOTES_PATH): Promise<{ path: string; line: string }> {
  const file = (await readNotes(path)) ?? NOTES_TEMPLATE;
  const day = new Date().toISOString().slice(0, 10);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, insertNote(file, section, text, day), "utf8");
  return { path, line: `- ${text.trim()} (${day})` };
}

// ---------- Numbers from the listening log ----------

type Count = { finished: number; skipped: number; stopped: number };

export type Rate = { plays: number; skipped: number; skipRate: number | null };

function rate(count: Count): Rate {
  const judged = count.finished + count.skipped;
  return {
    plays: count.finished + count.skipped + count.stopped,
    skipped: count.skipped,
    skipRate: judged === 0 ? null : Math.round((count.skipped / judged) * 100) / 100,
  };
}

function bump(map: Map<string, Count>, key: string, ended: ListenEvent["ended"]): void {
  const count = map.get(key) ?? { finished: 0, skipped: 0, stopped: 0 };
  count[ended] += 1;
  map.set(key, count);
}

export function songKey(event: Pick<ListenEvent, "uri" | "name" | "artists">): string {
  return event.uri ?? `${normalize(event.name)}|${normalize(event.artists[0] ?? "")}`;
}

function label(event: Pick<ListenEvent, "name" | "artists">): string {
  return event.artists.length > 0 ? `${event.name} - ${event.artists.join(", ")}` : event.name;
}

const DAY_MS = 86_400_000;

// A short skip says "not this song". A skip late in the song can mean "enough of it".
const QUICK_SKIP_MS = 30_000;

export function dayPart(date: Date): string {
  const hour = date.getHours();
  const part = hour >= 5 && hour < 12 ? "morning" : hour < 17 && hour >= 12 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
  const day = date.getDay();
  return `${day === 0 || day === 6 ? "weekend" : "weekday"} ${part}`;
}

type Ranked = { name: string } & Rate;

function ranked(map: Map<string, Count>, names: Map<string, string>, limit: number, order: (a: Ranked, b: Ranked) => number, keep: (item: Ranked) => boolean = () => true): Ranked[] {
  return [...map.entries()]
    .map(([key, count]) => ({ name: names.get(key) ?? key, ...rate(count) }))
    .filter(keep)
    .sort(order)
    .slice(0, limit);
}

const byPlays = (a: Ranked, b: Ranked) => b.plays - a.plays || a.name.localeCompare(b.name);
const bySkips = (a: Ranked, b: Ranked) => (b.skipRate ?? 0) - (a.skipRate ?? 0) || b.plays - a.plays;

export type WeekScore = {
  weekStart: string;
  dj: Rate & { newSongs: Rate; knownSongs: Rate };
  you: Rate;
};

// Skip rate of agent-selected songs for each of the last weeks. If the agent learns, this goes down.
export function weeklyScore(events: ListenEvent[], weeks: number, now = Date.now()): WeekScore[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const seen = new Set<string>();
  const rows = Array.from({ length: weeks }, (_, index) => ({
    start: now - (weeks - index) * 7 * DAY_MS,
    dj: { finished: 0, skipped: 0, stopped: 0 },
    djNew: { finished: 0, skipped: 0, stopped: 0 },
    djKnown: { finished: 0, skipped: 0, stopped: 0 },
    you: { finished: 0, skipped: 0, stopped: 0 },
  }));

  for (const event of sorted) {
    const key = songKey(event);
    const wasKnown = seen.has(key);
    seen.add(key);

    const time = Date.parse(event.at);
    const row = rows.find((item) => time >= item.start && time < item.start + 7 * DAY_MS);
    if (!row) {
      continue;
    }

    if (event.by === "dj") {
      row.dj[event.ended] += 1;
      (wasKnown ? row.djKnown : row.djNew)[event.ended] += 1;
    } else {
      row.you[event.ended] += 1;
    }
  }

  return rows.map((row) => ({
    weekStart: new Date(row.start).toISOString().slice(0, 10),
    dj: { ...rate(row.dj), newSongs: rate(row.djNew), knownSongs: rate(row.djKnown) },
    you: rate(row.you),
  }));
}

export type Profile = {
  notes: { path: string; text: string | null };
  said: { loved: FeelingSummary[]; meh: FeelingSummary[]; banned: FeelingSummary[] };
  data: { events: number; from: string | null; to: string | null; recentDays: number; djSongs: number };
  favourites: { artistsRecent: Ranked[]; artistsAllTime: Ranked[]; songs: Ranked[] };
  oftenSkipped: { artists: Ranked[]; songs: Ranked[] };
  situations: Array<{ when: string; plays: number; skipRate: number | null; artists: string[] }>;
  devices: Array<{ device: string; plays: number; artists: string[] }>;
  lastSets: Array<{ set: string; note?: string; at: string; played: number; skipped: string[] }>;
  score: WeekScore[];
  how: string[];
};

export async function buildProfile(options: { days: number; limit: number; now?: number }): Promise<Profile> {
  const now = options.now ?? Date.now();
  const [events, feelings, notes] = await Promise.all([readEvents(), readFeelings(), readNotes()]);
  const said = currentFeelings(feelings);
  const since = now - options.days * DAY_MS;
  const recent = events.filter((event) => Date.parse(event.at) >= since);

  const names = new Map<string, string>();
  const artistAll = new Map<string, Count>();
  const artistRecent = new Map<string, Count>();
  const songRecent = new Map<string, Count>();
  const quickSkips = new Map<string, Count>();
  const situationCount = new Map<string, Count>();
  const situationArtists = new Map<string, Map<string, Count>>();
  const deviceArtists = new Map<string, Map<string, Count>>();

  for (const event of events) {
    const isRecent = Date.parse(event.at) >= since;
    for (const artist of event.artists.slice(0, 1)) {
      const key = normalize(artist);
      names.set(key, artist);
      bump(artistAll, key, event.ended);
      if (isRecent) {
        bump(artistRecent, key, event.ended);
      }
    }

    if (!isRecent) {
      continue;
    }

    const song = songKey(event);
    names.set(song, label(event));
    bump(songRecent, song, event.ended);
    // A quick skip counts. A late skip or a stop counts as neither.
    bump(quickSkips, song, event.ended === "skipped" && event.playedMs < QUICK_SKIP_MS ? "skipped" : event.ended === "finished" ? "finished" : "stopped");

    const when = dayPart(new Date(event.at));
    bump(situationCount, when, event.ended);
    const first = event.artists[0];
    if (first) {
      const perWhen = situationArtists.get(when) ?? new Map<string, Count>();
      bump(perWhen, normalize(first), event.ended);
      situationArtists.set(when, perWhen);

      if (event.device) {
        const perDevice = deviceArtists.get(event.device) ?? new Map<string, Count>();
        bump(perDevice, normalize(first), event.ended);
        deviceArtists.set(event.device, perDevice);
      }
    }
  }

  const topNames = (map: Map<string, Count>, count: number) =>
    ranked(map, names, count, (a, b) => {
      // Finished plays first: they show what the user wants.
      const finished = (item: Ranked) => item.plays - item.skipped;
      return finished(b) - finished(a) || byPlays(a, b);
    }).map((item) => item.name);

  const sets = new Map<string, { set: string; note?: string; at: string; played: number; skipped: string[] }>();
  for (const event of events.filter((item) => item.by === "dj" && item.set)) {
    // A new set starts when the name changes or after 3 hours with no DJ song.
    const last = [...sets.values()].at(-1);
    const gap = last ? Date.parse(event.at) - Date.parse(last.at) : Infinity;
    const id = last && last.set === event.set && gap < 3 * 3_600_000 ? [...sets.keys()].at(-1)! : `${event.set}@${event.at}`;
    const entry = sets.get(id) ?? { set: event.set!, note: event.note, at: event.at, played: 0, skipped: [] };
    entry.at = event.at;
    if (event.ended === "skipped") {
      entry.skipped.push(label(event));
    } else {
      entry.played += 1;
    }

    sets.set(id, entry);
  }

  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));

  return {
    notes: { path: TASTE_NOTES_PATH, text: notes },
    said: {
      loved: said.filter((item) => item.kind === "love"),
      meh: said.filter((item) => item.kind === "meh"),
      banned: said.filter((item) => item.kind === "ban"),
    },
    data: {
      events: events.length,
      from: sorted[0]?.at ?? null,
      to: sorted.at(-1)?.at ?? null,
      recentDays: options.days,
      djSongs: events.filter((event) => event.by === "dj").length,
    },
    favourites: {
      artistsRecent: ranked(artistRecent, names, options.limit, byPlays, (item) => item.plays >= 3),
      artistsAllTime: ranked(artistAll, names, options.limit, byPlays, (item) => item.plays >= 3),
      songs: ranked(songRecent, names, options.limit, (a, b) => (b.plays - b.skipped) - (a.plays - a.skipped) || byPlays(a, b), (item) => item.plays - item.skipped >= 2),
    },
    oftenSkipped: {
      artists: ranked(artistRecent, names, options.limit, bySkips, (item) => item.plays >= 5 && (item.skipRate ?? 0) >= 0.5),
      songs: ranked(quickSkips, names, options.limit, bySkips, (item) => item.skipped >= 2 && (item.skipRate ?? 0) >= 0.5),
    },
    situations: [...situationCount.entries()]
      .map(([when, count]) => ({ when, ...rate(count), artists: topNames(situationArtists.get(when) ?? new Map(), 6) }))
      .filter((item) => item.plays >= 10)
      .sort((a, b) => b.plays - a.plays)
      .map(({ when, plays, skipRate, artists }) => ({ when, plays, skipRate, artists })),
    devices: [...deviceArtists.entries()]
      .map(([device, map]) => ({ device, plays: [...map.values()].reduce((sum, count) => sum + count.finished + count.skipped + count.stopped, 0), artists: topNames(map, 6) }))
      .filter((item) => item.plays >= 10)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 6),
    lastSets: [...sets.values()].slice(-3).reverse(),
    score: weeklyScore(events, 8, now),
    how: [
      "skipRate = skipped / (finished + skipped). Plays that stopped (pause, app closed) are not counted.",
      `oftenSkipped.songs counts only skips in the first ${QUICK_SKIP_MS / 1000} seconds.`,
      "score.dj.newSongs = songs that the user never played before the set. A high rate there is normal. Watch knownSongs and the trend.",
      "Times are local to this computer.",
    ],
  };
}
