import { execFile } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { readSession } from "./dj.js";
import { SpotError, toErrorPayload } from "./errors.js";
import { appendEvents, endedFor, type ListenEvent, writeJsonAtomic } from "./listening.js";
import { WATCH_LOCK_PATH, WATCH_LOG_PATH, WATCH_STATE_PATH } from "./paths.js";
import { getNow, type NowPlaying } from "./playback.js";
import { runtime } from "./runtime.js";

// Spotify sends no events to apps like this one. The watcher asks "what plays now?" at an interval
// and writes one line to listening.jsonl each time a song ends.

type Current = {
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  context?: string;
  device?: string;
  deviceType?: string;
  by: ListenEvent["by"];
  set?: string;
  note?: string;
  // The highest position seen, and when it was seen.
  progressMs: number;
  seenAt: number;
  playing: boolean;
};

export type WatchState = {
  current: Current | null;
  lastPollAt?: string;
  lastError?: { at: string; code: string; message: string } | null;
  recorded: number;
  pid?: number;
};

export const POLL_MS = { playing: 20_000, paused: 60_000, idle: 120_000 };

export function emptyState(): WatchState {
  return { current: null, lastError: null, recorded: 0 };
}

function finish(current: Current, at: number, playedMs: number, changed: boolean): ListenEvent {
  const duration = current.durationMs;
  const played = Math.max(0, Math.round(duration ? Math.min(playedMs, duration) : playedMs));

  return {
    at: new Date(at).toISOString(),
    uri: current.uri,
    name: current.name,
    artists: current.artists,
    album: current.album,
    durationMs: duration,
    playedMs: played,
    ended: endedFor(played, duration, changed),
    by: current.by,
    set: current.set,
    note: current.note,
    device: current.device,
    deviceType: current.deviceType,
    context: current.context,
    source: "watch",
  };
}

type DjInfo = { playlistUri: string; name: string; note?: string; ended: boolean } | null;

function startCurrent(now: NowPlaying, at: number, dj: DjInfo): Current | null {
  const track = now.track;
  // Only songs. Podcast episodes do not say anything about music taste.
  if (!track || !track.uri.startsWith("spotify:track:")) {
    return null;
  }

  const fromDj = Boolean(dj && !dj.ended && now.context?.uri === dj.playlistUri);
  return {
    uri: track.uri,
    name: track.name,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    context: now.context?.uri,
    device: now.device?.name,
    deviceType: now.device?.type,
    by: fromDj ? "dj" : "you",
    set: fromDj ? dj?.name : undefined,
    note: fromDj ? dj?.note : undefined,
    progressMs: now.progressMs ?? 0,
    seenAt: at,
    playing: now.isPlaying,
  };
}

// One poll. Pure: the same input gives the same output, so the rules are easy to test.
export function observe(
  state: WatchState,
  now: NowPlaying,
  at: number,
  dj: DjInfo,
): { state: WatchState; events: ListenEvent[] } {
  const events: ListenEvent[] = [];
  const previous = state.current;
  const track = now.active ? now.track : null;
  const progress = now.progressMs ?? 0;

  if (previous && track && track.uri === previous.uri) {
    // The same song. A big jump back means it started again (repeat, or the back button).
    if (progress + 5_000 < previous.progressMs) {
      const elapsed = previous.playing ? at - previous.seenAt : 0;
      const played = previous.progressMs + Math.max(0, elapsed - progress);
      events.push(finish(previous, at - progress, played, true));
      return { state: { ...state, current: startCurrent(now, at, dj), recorded: state.recorded + events.length }, events };
    }

    return {
      state: {
        ...state,
        current: { ...previous, progressMs: Math.max(previous.progressMs, progress), seenAt: at, playing: now.isPlaying },
      },
      events,
    };
  }

  if (previous) {
    if (track) {
      // A new song. The old song played until the new one started: (time since the last poll) - (new position).
      const elapsed = previous.playing ? at - previous.seenAt : 0;
      const played = previous.progressMs + Math.max(0, elapsed - progress);
      events.push(finish(previous, at - progress, played, true));
    } else {
      // The music stopped or Spotify closed. Only the position that was seen is sure.
      events.push(finish(previous, previous.seenAt, previous.progressMs, false));
    }
  }

  return {
    state: { ...state, current: track ? startCurrent(now, at, dj) : null, recorded: state.recorded + events.length },
    events,
  };
}

export async function readWatchState(): Promise<WatchState> {
  try {
    return { ...emptyState(), ...(JSON.parse(await readFile(WATCH_STATE_PATH, "utf8")) as WatchState) };
  } catch {
    return emptyState();
  }
}

async function djInfo(): Promise<DjInfo> {
  const session = await readSession().catch(() => null);
  return session
    ? { playlistUri: session.playlistUri, name: session.name, note: session.note, ended: session.endedAt !== undefined }
    : null;
}

export type PollResult = { state: WatchState; events: ListenEvent[]; waitMs: number };

export async function pollOnce(): Promise<PollResult> {
  const before = await readWatchState();
  const at = Date.now();

  try {
    const now = await getNow();
    const { state, events } = observe(before, now, at, await djInfo());
    await appendEvents(events);
    const next: WatchState = { ...state, lastPollAt: new Date(at).toISOString(), lastError: null, pid: process.pid };
    await writeJsonAtomic(WATCH_STATE_PATH, next);

    const waitMs = !now.active ? POLL_MS.idle : now.isPlaying ? POLL_MS.playing : POLL_MS.paused;
    return { state: next, events, waitMs };
  } catch (error) {
    const payload = toErrorPayload(error);
    const next: WatchState = {
      ...before,
      lastPollAt: new Date(at).toISOString(),
      lastError: { at: new Date(at).toISOString(), code: payload.code, message: payload.message },
      pid: process.pid,
    };
    await writeJsonAtomic(WATCH_STATE_PATH, next);

    // A login problem needs a person. Ask again only now and then.
    const waitMs = payload.retryAfterSeconds
      ? payload.retryAfterSeconds * 1000
      : ["NOT_LOGGED_IN", "AUTH_EXPIRED", "PREMIUM_REQUIRED"].includes(payload.code) ? 15 * 60_000 : POLL_MS.idle;
    return { state: next, events: [], waitMs };
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Two watchers would write each song two times. The lock file holds the pid of the one that runs.
export async function takeWatchLock(): Promise<() => Promise<void>> {
  await mkdir(dirname(WATCH_LOCK_PATH), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(WATCH_LOCK_PATH, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        await rm(WATCH_LOCK_PATH, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const pid = Number((await readFile(WATCH_LOCK_PATH, "utf8").catch(() => "")).trim());
      if (pid && pidAlive(pid)) {
        throw new SpotError("BAD_INPUT", `A watcher already runs (pid ${pid}).`, {
          hint: "Run `spot watch status`. Only one watcher is necessary.",
          extra: { pid },
        });
      }

      await rm(WATCH_LOCK_PATH, { force: true });
    }
  }

  throw new SpotError("INTERNAL", "Cannot take the watcher lock.");
}

// The lock stays held during the poll, so `--once` and a running watcher never record a song two times.
export async function pollOnceLocked(): Promise<PollResult> {
  const release = await takeWatchLock();
  try {
    return await pollOnce();
  } finally {
    await release();
  }
}

export async function runWatch(options: { log: (line: string) => void; signal?: AbortSignal }): Promise<void> {
  const release = await takeWatchLock();
  // launchd stops the watcher with SIGTERM. Remove the lock, or the next start must wait for a stale-pid check.
  const stop = () => {
    void release().finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!options.signal?.aborted) {
      const { events, waitMs, state } = await pollOnce();
      for (const event of events) {
        options.log(JSON.stringify({ at: event.at, ended: event.ended, by: event.by, song: `${event.name} - ${event.artists.join(", ")}`, playedMs: event.playedMs }));
      }

      if (state.lastError) {
        options.log(JSON.stringify({ at: state.lastError.at, error: state.lastError.code, message: state.lastError.message }));
      }

      await runtime.sleep(waitMs);
    }
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await release();
  }
}

// ---------- macOS: keep the watcher running with launchd ----------

export const LAUNCH_LABEL = "com.spotify-cli.watch";

export function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCH_LABEL}.plist`);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function launchAgentPlist(node: string, script: string, env: Record<string, string>): string {
  const envXml = Object.entries(env)
    .map(([key, value]) => `      <key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(node)}</string>
    <string>${escapeXml(script)}</string>
    <string>watch</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${escapeXml(WATCH_LOG_PATH)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(WATCH_LOG_PATH)}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile("launchctl", args, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });
}

function requireMac(): void {
  if (process.platform !== "darwin") {
    throw new SpotError("BAD_INPUT", "`spot watch install` works only on macOS.", {
      hint: "On other systems, run `spot watch run` with your own service manager.",
    });
  }
}

export async function installLaunchAgent(script: string): Promise<{ path: string; loaded: boolean }> {
  requireMac();
  const path = launchAgentPath();
  const env: Record<string, string> = { SPOT_OUTPUT: "json", PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (process.env.SPOT_CONFIG_DIR) {
    env.SPOT_CONFIG_DIR = process.env.SPOT_CONFIG_DIR;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, launchAgentPlist(process.execPath, script, env), "utf8");

  const domain = `gui/${process.getuid?.() ?? 501}`;
  await launchctl(["bootout", `${domain}/${LAUNCH_LABEL}`]);
  const loaded = await launchctl(["bootstrap", domain, path]);
  if (!loaded.ok) {
    throw new SpotError("INTERNAL", `launchctl did not start the watcher: ${loaded.output}`, { extra: { path } });
  }

  return { path, loaded: true };
}

export async function uninstallLaunchAgent(): Promise<{ path: string; removed: boolean }> {
  requireMac();
  const path = launchAgentPath();
  await launchctl(["bootout", `gui/${process.getuid?.() ?? 501}/${LAUNCH_LABEL}`]);
  const existed = await readFile(path).then(() => true, () => false);
  await rm(path, { force: true });
  return { path, removed: existed };
}

export async function launchAgentInstalled(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  return readFile(launchAgentPath()).then(() => true, () => false);
}

export async function watchStatus(): Promise<{
  running: boolean;
  pid: number | null;
  installed: boolean;
  lastPollAt: string | null;
  lastError: WatchState["lastError"];
  recorded: number;
  current: string | null;
}> {
  const state = await readWatchState();
  const pid = Number((await readFile(WATCH_LOCK_PATH, "utf8").catch(() => "")).trim()) || null;

  return {
    running: pid !== null && pidAlive(pid),
    pid,
    installed: await launchAgentInstalled(),
    lastPollAt: state.lastPollAt ?? null,
    lastError: state.lastError ?? null,
    recorded: state.recorded,
    current: state.current ? `${state.current.name} - ${state.current.artists.join(", ")}` : null,
  };
}
