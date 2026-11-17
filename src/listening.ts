import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { SpotError } from "./errors.js";
import { LISTENING_PATH } from "./paths.js";

// One line for each song that ended. The file only grows, so a crash can lose one line at most.
export type ListenEvent = {
  // When the play ended, ISO time.
  at: string;
  uri?: string;
  name: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  playedMs: number;
  // "stopped" = the music stopped or the app closed. It does not say if the user liked the song.
  ended: "finished" | "skipped" | "stopped";
  // Who selected the song: an agent's DJ set, or the user.
  by: "dj" | "you";
  set?: string;
  note?: string;
  device?: string;
  deviceType?: string;
  context?: string;
  source: "watch" | "import";
};

export async function appendEvents(events: ListenEvent[], path = LISTENING_PATH): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
}

export async function readEvents(path = LISTENING_PATH): Promise<ListenEvent[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const events: ListenEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    // A line cut short by a crash is skipped, not fatal.
    try {
      events.push(JSON.parse(line) as ListenEvent);
    } catch {
      continue;
    }
  }

  return events;
}

// A song counts as finished when it played to near its end. Crossfade and gaps between polls cost some seconds.
const END_MARGIN_MS = 15_000;

export function endedFor(playedMs: number, durationMs: number | undefined, changed: boolean): ListenEvent["ended"] {
  if (durationMs && playedMs >= durationMs - END_MARGIN_MS) {
    return "finished";
  }

  return changed ? "skipped" : "stopped";
}

// ---------- Import of a Spotify data download ----------

type ExtendedRow = {
  ts?: string;
  ms_played?: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  reason_end?: string | null;
  skipped?: boolean | null;
  platform?: string | null;
};

type BasicRow = {
  endTime?: string;
  artistName?: string;
  trackName?: string;
  msPlayed?: number;
};

// "Extended streaming history": each play, with the reason it ended.
function fromExtended(row: ExtendedRow): ListenEvent | null {
  if (!row.master_metadata_track_name || !row.ts) {
    return null; // A podcast episode or a row with no song.
  }

  const skipped = row.skipped === true || row.reason_end === "fwdbtn";
  return {
    at: new Date(row.ts).toISOString(),
    uri: row.spotify_track_uri ?? undefined,
    name: row.master_metadata_track_name,
    artists: row.master_metadata_album_artist_name ? [row.master_metadata_album_artist_name] : [],
    album: row.master_metadata_album_album_name ?? undefined,
    playedMs: Number(row.ms_played ?? 0),
    ended: skipped ? "skipped" : row.reason_end === "trackdone" ? "finished" : "stopped",
    by: "you",
    device: row.platform ?? undefined,
    source: "import",
  };
}

// The short "Account data" download: one year, no reason. Under 30 seconds is counted as a skip.
function fromBasic(row: BasicRow): ListenEvent | null {
  if (!row.trackName || !row.endTime) {
    return null;
  }

  const playedMs = Number(row.msPlayed ?? 0);
  return {
    at: new Date(`${row.endTime.replace(" ", "T")}:00Z`).toISOString(),
    name: row.trackName,
    artists: row.artistName ? [row.artistName] : [],
    playedMs,
    ended: playedMs < 30_000 ? "skipped" : "finished",
    by: "you",
    source: "import",
  };
}

const HISTORY_FILE = /^(Streaming_History_Audio|StreamingHistory_music|StreamingHistory)[^/]*\.json$/i;

async function findHistoryFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  async function walk(path: string, depth: number): Promise<void> {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new SpotError("BAD_INPUT", `Cannot read ${path}.`);
    }

    if (info.isFile()) {
      files.push(path);
      return;
    }

    if (info.isDirectory() && depth < 4) {
      for (const entry of (await readdir(path)).sort()) {
        const child = join(path, entry);
        const childInfo = await stat(child);
        if (childInfo.isDirectory() || HISTORY_FILE.test(entry)) {
          await walk(child, depth + 1);
        }
      }
    }
  }

  for (const path of paths) {
    await walk(path, 0);
  }

  return files;
}

function eventKey(event: ListenEvent): string {
  return `${event.at}|${event.uri ?? `${event.name}|${event.artists[0] ?? ""}`}|${event.playedMs}`;
}

export type ImportResult = {
  files: string[];
  added: number;
  alreadyImported: number;
  skippedRows: number;
  from?: string;
  to?: string;
};

export async function importHistory(paths: string[], path = LISTENING_PATH): Promise<ImportResult> {
  const files = await findHistoryFiles(paths);
  if (files.length === 0) {
    throw new SpotError("NOT_FOUND", "Found no Spotify history files.", {
      hint: "Unzip the Spotify download first. Give the folder, or files named Streaming_History_Audio_*.json.",
    });
  }

  const known = new Set((await readEvents(path)).filter((event) => event.source === "import").map(eventKey));
  const fresh: ListenEvent[] = [];
  let alreadyImported = 0;
  let skippedRows = 0;

  for (const file of files) {
    let rows: unknown;
    try {
      rows = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw new SpotError("BAD_INPUT", `${basename(file)} is not a Spotify history file (not JSON).`);
    }

    if (!Array.isArray(rows)) {
      throw new SpotError("BAD_INPUT", `${basename(file)} is not a Spotify history file (not a list).`);
    }

    for (const row of rows as Array<Record<string, unknown>>) {
      const event = "ts" in row ? fromExtended(row as ExtendedRow) : fromBasic(row as BasicRow);
      if (!event || Number.isNaN(Date.parse(event.at))) {
        skippedRows += 1;
        continue;
      }

      const key = eventKey(event);
      if (known.has(key)) {
        alreadyImported += 1;
        continue;
      }

      known.add(key);
      fresh.push(event);
    }
  }

  fresh.sort((a, b) => a.at.localeCompare(b.at));
  await appendEvents(fresh, path);

  return {
    files: files.map((file) => basename(file)),
    added: fresh.length,
    alreadyImported,
    skippedRows,
    from: fresh[0]?.at,
    to: fresh.at(-1)?.at,
  };
}

// Writes JSON in one step, so a reader never sees half a file.
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
