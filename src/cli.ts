import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";
import open from "open";

import { parseAuthorizationCallbackUrl } from "./auth-callback.js";
import {
  deleteAuthSession,
  readAuthSession,
  writeAuthSession,
} from "./auth-session.js";
import {
  getResolvedConfig,
  readConfig,
  setClientId,
  setDefaultDevice,
  setRedirectUri,
} from "./config-store.js";
import { ensureDevice, getDevices, getResolvedDeviceId } from "./devices.js";
import {
  type DjStatus,
  getStatus,
  type SetTrack,
  startSession,
  steerSession,
  stopSession,
} from "./dj.js";
import { exitCodeFor, SpotError, toErrorPayload } from "./errors.js";
import {
  addFeeling,
  assertKind,
  type BanRule,
  banFor,
  currentFeelings,
  type Feeling,
  readFeelings,
} from "./feelings.js";
import { importHistory, readEvents } from "./listening.js";
import {
  parseBoundedInteger,
  parseOnOffState,
} from "./input-validation.js";
import { formatTrackSummary } from "./output.js";
import {
  getNow,
  getRecentTracks,
  type NowPlaying,
  play,
  playOn,
  type PlayResult,
} from "./playback.js";
import { normalizeSearchLimit, resolveDevice } from "./playback-utils.js";
import {
  addPlaylistItems,
  assertPlaylistItems,
  createPlaylist,
  getPlaylist,
  listPlaylists,
  removePlaylistItems,
  replacePlaylistItems,
  resolvePlaylistRef,
  updatePlaylistDetails,
} from "./playlists.js";
import { parseNameLines, resolveNames, type ResolveResult } from "./resolve.js";
import { parseSearchTypes, search } from "./search.js";
import { toDevice, toTrack } from "./shapes.js";
import {
  buildAuthorizationUrl,
  clearStoredTokens,
  completeAuthorizationWithCode,
  getStoredTokens,
  spotifyRequest,
} from "./spotify-client.js";
import { normalizeSpotifyUri } from "./spotify-uri.js";
import { addNote, buildProfile, DEFAULT_SECTION, type Profile, type WeekScore, weeklyScore } from "./profile.js";
import { getTaste } from "./taste.js";
import {
  installLaunchAgent,
  pollOnceLocked,
  runWatch,
  uninstallLaunchAgent,
  watchStatus,
} from "./watch.js";

export const VERSION = "2.0.1";

export type OutputMode = "json" | "text";

export type Io = {
  out: (text: string) => void;
  err: (text: string) => void;
  isTTY: boolean;
  env: Record<string, string | undefined>;
  readStdin: () => Promise<string>;
};

// What a command gives back: data for agents, text for people.
type Outcome = {
  data: Record<string, unknown>;
  text: string;
  // Documentation prints as plain text in both modes.
  plain?: boolean;
};

type Handle = (action: () => Promise<Outcome>) => Promise<void>;

export function defaultIo(): Io {
  return {
    out: (text) => {
      console.log(text);
    },
    err: (text) => {
      console.error(text);
    },
    isTTY: Boolean(process.stdout.isTTY),
    env: process.env,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

// An agent has no terminal, so it gets JSON with no flag to remember.
export function resolveOutputMode(args: string[], io: Pick<Io, "isTTY" | "env">): OutputMode {
  const end = args.indexOf("--");
  const flags = end === -1 ? args : args.slice(0, end);

  if (flags.includes("--json")) {
    return "json";
  }

  if (flags.includes("--text")) {
    return "text";
  }

  const fromEnv = io.env.SPOT_OUTPUT?.toLowerCase();
  if (fromEnv === "json" || fromEnv === "text") {
    return fromEnv;
  }

  return io.isTTY ? "text" : "json";
}

export const LEARN_HINT =
  "Learn from this set: write each lesson with `spot taste note \"...\"` (for example: skips songs over 6 minutes when working). Record the user's words with `spot feel`.";

function pct(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function describeScore(score: WeekScore[]): string {
  return score
    .map((week) => `  ${week.weekStart}: agent songs ${week.dj.plays} played, ${pct(week.dj.skipRate)} skipped (new ${pct(week.dj.newSongs.skipRate)}, known ${pct(week.dj.knownSongs.skipRate)}) · your own picks ${pct(week.you.skipRate)} skipped`)
    .join("\n");
}

function describeProfile(profile: Profile): string {
  const said = (items: Profile["said"]["loved"]) =>
    items.map((item) => `  ${item.scope === "artist" ? `artist ${item.artists.join(", ")}` : `${item.name ?? item.uri}${item.artists.length ? ` - ${item.artists.join(", ")}` : ""}`}${item.why ? ` (${item.why})` : ""}`).join("\n") || "  none";
  const ranks = (items: Array<{ name: string; plays: number; skipRate: number | null }>) =>
    items.map((item) => `  ${item.name}: ${item.plays} plays, ${pct(item.skipRate)} skipped`).join("\n") || "  none";

  return [
    `Listening data: ${profile.data.events} plays${profile.data.from ? ` from ${profile.data.from.slice(0, 10)} to ${profile.data.to?.slice(0, 10)}` : ""}. Agent-selected: ${profile.data.djSongs}.`,
    `Taste notes (${profile.notes.path}):\n${profile.notes.text?.trim() ?? "  none yet"}`,
    `Banned:\n${said(profile.said.banned)}`,
    `Loved:\n${said(profile.said.loved)}`,
    `Less often:\n${said(profile.said.meh)}`,
    `Favourite artists, last ${profile.data.recentDays} days:\n${ranks(profile.favourites.artistsRecent)}`,
    `Favourite songs, last ${profile.data.recentDays} days:\n${ranks(profile.favourites.songs)}`,
    `Often skipped artists:\n${ranks(profile.oftenSkipped.artists)}`,
    `Often skipped songs:\n${ranks(profile.oftenSkipped.songs)}`,
    `Situations:\n${profile.situations.map((item) => `  ${item.when} (${item.plays} plays, ${pct(item.skipRate)} skipped): ${item.artists.join(", ")}`).join("\n") || "  not enough data"}`,
    `Devices:\n${profile.devices.map((item) => `  ${item.device} (${item.plays} plays): ${item.artists.join(", ")}`).join("\n") || "  not enough data"}`,
    `Score by week:\n${describeScore(profile.score)}`,
  ].join("\n\n");
}

function numbered(items: Array<{ label: string }>): string {
  return items.map((item, index) => `${String(index + 1).padStart(2)}. ${item.label}`).join("\n");
}

function describeNow(now: NowPlaying): string {
  if (!now.active) {
    return "Nothing is currently active on Spotify Connect.";
  }

  const state = now.isPlaying ? "Playing" : "Paused";
  const where = now.device ? ` on ${now.device.name}` : "";
  return `${state}: ${now.track?.label ?? "nothing"}${where}`;
}

function describePlay(result: PlayResult): string {
  const where = result.device ? ` on ${result.device.name}` : "";
  const what = result.item?.label ?? result.item?.uri ?? "";

  if (result.action === "queued") {
    return `Added ${what} to the queue.`;
  }

  if (result.action === "resumed") {
    return `Playback started${where}.`;
  }

  return `Playing ${what}${where}.`;
}

function describeMissed(resolved: ResolveResult): string {
  if (resolved.missed.length === 0) {
    return "";
  }

  const lines = resolved.missed.map((miss) =>
    `  ${miss.input}${miss.closest ? ` (closest: ${miss.closest.label})` : ""}`);
  return `\nNot found (${resolved.missed.length}):\n${lines.join("\n")}`;
}

function describeStatus(status: DjStatus): string {
  const lines = [
    `DJ set "${status.session.name}", ${status.session.minutes} min${status.session.ended ? ", ended" : ""}`,
    status.inSession
      ? `Now: ${status.current?.label ?? "unknown"}${status.isPlaying ? "" : " (paused)"}`
      : "The set is not playing now.",
    `Played ${status.played.length}, skipped ${status.skipped.length}, remaining ${status.remaining.length}`,
  ];

  if (status.skipped.length > 0) {
    lines.push("Skipped:", ...status.skipped.map((track) => `  ${track.label}`));
  }

  return lines.join("\n");
}

async function readSongLines(items: string[], from: string | undefined, io: Io): Promise<string[]> {
  const lines = [...items];

  if (from !== undefined) {
    let text: string;
    if (from === "-") {
      text = await io.readStdin();
    } else {
      try {
        text = await readFile(from, "utf8");
      } catch {
        throw new SpotError("BAD_INPUT", `Cannot read the file ${from}.`);
      }
    }

    lines.push(...parseNameLines(text));
  }

  return lines;
}

type Blocked = { input: string; uri: string; label?: string; ban: BanRule };

type SongsResult = ResolveResult & { blocked: Blocked[] };

// The user's bans are kept by the tool, so an agent cannot forget them.
async function applyBans(result: ResolveResult, include: boolean): Promise<SongsResult> {
  if (include) {
    return { ...result, blocked: [] };
  }

  const feelings = currentFeelings(await readFeelings());

  // A URI or link input has no artist names. Look them up, but only when an artist ban needs them.
  if (feelings.some((feeling) => feeling.kind === "ban" && feeling.scope === "artist")) {
    for (const item of result.resolved) {
      if ((item.artists ?? []).length === 0 && item.uri.startsWith("spotify:track:")) {
        const raw = await spotifyRequest<Record<string, any>>(`/tracks/${item.uri.split(":")[2]}`);
        const track = toTrack(raw);
        if (track) {
          item.name = track.name;
          item.artists = track.artists;
          item.label = track.label;
        }
      }
    }
  }

  const blocked: Blocked[] = [];
  const resolved = result.resolved.filter((item) => {
    const ban = banFor(item, feelings);
    if (ban) {
      blocked.push({ input: item.input, uri: item.uri, label: item.label, ban });
    }

    return !ban;
  });

  return { ...result, resolved, blocked };
}

function describeBlocked(result: { blocked: Blocked[] }): string {
  if (result.blocked.length === 0) {
    return "";
  }

  const lines = result.blocked.map((item) =>
    `  ${item.label ?? item.input} (banned ${item.ban.scope}${item.ban.why ? `: ${item.ban.why}` : ""})`);
  return `\nBlocked by your bans (${result.blocked.length}):\n${lines.join("\n")}`;
}

// Songs come as names ("Artist - Title"), URIs or links, as arguments or from a file.
async function resolveSongs(
  items: string[],
  options: { from?: string; loose?: boolean; includeBanned?: boolean },
  io: Io,
  required: boolean,
): Promise<SongsResult> {
  const lines = await readSongLines(items, options.from, io);

  if (lines.length === 0) {
    if (required) {
      throw new SpotError("BAD_INPUT", "Give one song or more.", {
        hint: "Give songs as arguments, or one song for each line with --from <file> (use - for stdin).",
      });
    }

    return { resolved: [], missed: [], duplicatesRemoved: 0, blocked: [] };
  }

  const result = await applyBans(
    await resolveNames(lines, { loose: options.loose }),
    Boolean(options.includeBanned),
  );

  if (result.resolved.length === 0) {
    const allBanned = result.blocked.length > 0;
    throw new SpotError("NOT_FOUND", allBanned ? "Each song found is banned by the user." : "Spotify found none of the songs.", {
      hint: allBanned ? "Select different songs. Read the bans with `spot taste profile`." : "Check the names. Use the form: Artist - Title.",
      extra: { missed: result.missed, blocked: result.blocked },
    });
  }

  return result;
}

function toSetTracks(result: ResolveResult): SetTrack[] {
  return result.resolved.map((item) => ({ uri: item.uri, label: item.label ?? item.uri }));
}

function parseLimit(value: number | undefined, label: string, max: number, fallback: number): number {
  return value === undefined ? fallback : parseBoundedInteger(value, label, { min: 1, max });
}

function buildProgram(handle: Handle, io: Io, mode: OutputMode): Command {
  const program = new Command();

  // Settings go on first: subcommands copy them when they are created.
  program
    .name("spot")
    .description("Control Spotify from the command line")
    .version(VERSION)
    .option("--json", "Print one JSON object (the default when no terminal is attached)")
    .option("--text", "Print text for people (the default in a terminal)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        io.out(text.replace(/\n$/, ""));
      },
      // In JSON mode the caller gets one JSON error object, not Commander's text.
      writeErr: (text) => {
        if (mode === "text") {
          io.err(text.replace(/\n$/, ""));
        }
      },
    })
    .addHelpText("after", "\nAgents: run `spot guide` for the short manual.");

  const withDevice = (command: Command): Command =>
    command.option("-d, --device <device>", "Device name or id");

  const withSongs = (command: Command): Command =>
    command
      .option("--from <file>", "File with one song for each line. Use - for stdin.")
      .option("--loose", "Accept weak matches. The default reports them as not found.")
      .option("--include-banned", "Keep songs that the user banned. Use only when the user asks for one.");

  program
    .command("guide")
    .description("Print the short manual for agents")
    .action(() =>
      handle(async () => {
        const guide = await readFile(new URL("../skills/spot/SKILL.md", import.meta.url), "utf8");
        return { data: { guide }, text: guide.trimEnd(), plain: true };
      }),
    );

  const configCommand = program.command("config").description("Manage local CLI config");

  configCommand
    .command("set-client-id")
    .argument("<clientId>", "Spotify application client ID")
    .description("Store the Spotify client ID locally")
    .action((clientId) =>
      handle(async () => {
        await setClientId(clientId);
        return { data: { stored: "clientId" }, text: "Stored Spotify client ID." };
      }),
    );

  configCommand
    .command("set-redirect-uri")
    .argument("<redirectUri>", "Redirect URI allowlisted in your Spotify app")
    .description("Override the default local callback URL")
    .action((redirectUri) =>
      handle(async () => {
        await setRedirectUri(redirectUri);
        return { data: { stored: "redirectUri" }, text: "Stored redirect URI." };
      }),
    );

  configCommand
    .command("set-default-device")
    .argument("[device]", "Device name or id. Empty removes the default.")
    .description("Select where music starts when no device is active")
    .action((device?: string) =>
      handle(async () => {
        await setDefaultDevice(device || undefined);
        return {
          data: { defaultDevice: device || null },
          text: device ? `Default device set to ${device}.` : "Default device removed.",
        };
      }),
    );

  configCommand
    .command("show")
    .description("Show the current resolved config")
    .action(() =>
      handle(async () => {
        const rawConfig = await readConfig();
        let resolvedConfig: { clientId: string; redirectUri: string } | undefined;

        try {
          resolvedConfig = await getResolvedConfig();
        } catch {
          resolvedConfig = undefined;
        }

        // The client ID is cut short in both blocks, so it does not go into logs.
        const short = (clientId?: string) => (clientId ? `${clientId.slice(0, 6)}...` : null);
        const data = {
          stored: { ...rawConfig, clientId: short(rawConfig.clientId) },
          resolved: {
            clientId: short(resolvedConfig?.clientId),
            redirectUri: resolvedConfig?.redirectUri ?? rawConfig.redirectUri ?? null,
          },
        };

        return { data, text: JSON.stringify(data, null, 2) };
      }),
    );

  const authCommand = program.command("auth").description("Spotify login helpers");

  authCommand
    .command("login")
    .option("--client-id <clientId>", "Store a client ID before starting login")
    .option("--redirect-uri <redirectUri>", "Override and store the redirect URI before starting login")
    .description("Log into Spotify with PKCE in your browser")
    .action((options) =>
      handle(async () => {
        if (options.clientId) {
          await setClientId(options.clientId);
        }

        if (options.redirectUri) {
          await setRedirectUri(options.redirectUri);
        }

        const { authUrl, codeVerifier, state } = await buildAuthorizationUrl();
        await writeAuthSession({
          codeVerifier,
          createdAt: Date.now(),
          state,
        });

        let browserOpened = true;
        try {
          await open(authUrl);
        } catch {
          browserOpened = false;
        }

        const next = "After Spotify redirects, copy the full final URL and run: spot auth finish '<redirected-url>'";
        return {
          data: { authUrl, browserOpened, next },
          text: [
            browserOpened
              ? "Opening Spotify authorization in your browser..."
              : "Automatic browser launch failed. Open the URL below.",
            `${next}\n`,
            `Authorization URL:\n${authUrl}\n`,
          ].join("\n"),
        };
      }),
    );

  authCommand
    .command("finish")
    .argument("<callbackUrl>", "The full redirect URL after Spotify authorization")
    .description("Finish a pending Spotify login using the redirected callback URL")
    .action((callbackUrl) =>
      handle(async () => {
        const session = await readAuthSession();
        if (!session) {
          throw new SpotError("BAD_INPUT", "No pending Spotify login found.", {
            hint: "Run `spot auth login` first.",
          });
        }

        const code = parseAuthorizationCallbackUrl(callbackUrl, session.state);
        const tokens = await completeAuthorizationWithCode(session.codeVerifier, code);
        await deleteAuthSession();
        return {
          data: {
            connected: true,
            expiresAt: new Date(tokens.expiresAt).toISOString(),
            scope: tokens.scope,
          },
          text: `Connected. Token expires at ${new Date(tokens.expiresAt).toLocaleString()}.`,
        };
      }),
    );

  authCommand
    .command("status")
    .description("Show whether the CLI is connected")
    .action(() =>
      handle(async () => {
        const tokens = await getStoredTokens();
        if (!tokens) {
          return { data: { connected: false }, text: "Not connected." };
        }

        const profile = await spotifyRequest<{ display_name?: string; id: string }>("/me");
        const data = {
          connected: true,
          user: profile.display_name ?? profile.id,
          expiresAt: new Date(tokens.expiresAt).toISOString(),
          scope: tokens.scope,
        };

        return { data, text: JSON.stringify(data, null, 2) };
      }),
    );

  authCommand
    .command("logout")
    .description("Clear the saved Spotify token")
    .action(() =>
      handle(async () => {
        await clearStoredTokens();
        return { data: { connected: false }, text: "Removed stored Spotify tokens." };
      }),
    );

  program
    .command("me")
    .description("Show the current Spotify account")
    .action(() =>
      handle(async () => {
        const profile = await spotifyRequest<Record<string, any>>("/me");
        const data = {
          id: profile.id,
          displayName: profile.display_name ?? null,
          uri: profile.uri,
        };

        return { data, text: JSON.stringify(data, null, 2) };
      }),
    );

  withDevice(
    program
      .command("play")
      .argument("[target...]", "Words to search for, or a Spotify URI or link. Empty = resume.")
      .option("-t, --type <type>", "What the words name: track, album, artist or playlist", "track")
      .option("--mine", "Look for the name in your own playlists")
      .option("--queue", "Add the song to the queue. The current song continues.")
      .option("--wake", "Open Spotify on this computer if no device is available")
      .description("Find something by name and play it, in one step"),
  ).action((target: string[], options) =>
    handle(async () => {
      const types = parseSearchTypes(String(options.type));
      if (types.length !== 1) {
        throw new SpotError("BAD_INPUT", "Give one --type.");
      }

      const result = await play({
        target: target.join(" ").trim() || undefined,
        type: types[0],
        mine: Boolean(options.mine),
        queue: Boolean(options.queue),
        device: options.device,
        wake: Boolean(options.wake),
      });

      return { data: result, text: describePlay(result) };
    }),
  );

  program
    .command("now")
    .description("Show what plays now, in a small form")
    .action(() =>
      handle(async () => {
        const now = await getNow();
        return { data: now, text: describeNow(now) };
      }),
    );

  program
    .command("search")
    .argument("<query>", "Search query")
    .option(
      "-t, --type <types>",
      "Comma-separated types: track,artist,album,playlist,show,episode,audiobook",
      "track,album,artist,playlist",
    )
    .option("-l, --limit <limit>", "Results per type (Spotify dev mode max is 10)", Number)
    .description("Search Spotify and print URIs you can reuse in other commands")
    .action((query, options) =>
      handle(async () => {
        if (options.limit !== undefined && !Number.isFinite(options.limit)) {
          throw new SpotError("BAD_INPUT", "limit must be a number.");
        }

        const limit = normalizeSearchLimit(options.limit);
        const results = await search(query, parseSearchTypes(String(options.type)), limit);

        const sections = Object.entries(results).map(([type, items]) => {
          const heading = `\n${type}\n${"-".repeat(type.length)}`;
          const body = items.length === 0
            ? "No results."
            : items.map((item) => `${item.label} (${item.uri})`).join("\n");
          return `${heading}\n${body}`;
        });

        return { data: { query, results }, text: sections.join("\n") };
      }),
    );

  withSongs(
    program
      .command("resolve")
      .argument("[songs...]", "Song names, for example \"NF - Fear\"")
      .description("Change many song names into Spotify URIs in one step"),
  ).action((songs: string[], options) =>
    handle(async () => {
      const lines = await readSongLines(songs, options.from, io);
      if (lines.length === 0) {
        throw new SpotError("BAD_INPUT", "Give one song or more.", {
          hint: "Give songs as arguments, or one song for each line with --from <file> (use - for stdin).",
        });
      }

      const result = await resolveNames(lines, { loose: Boolean(options.loose) });
      const found = result.resolved
        .map((item) => `${item.label ?? item.uri} (${item.uri}) [${item.confidence}]`)
        .join("\n");

      return { data: result, text: `${found}${describeMissed(result)}`.trim() };
    }),
  );

  program
    .command("recent")
    .option("-l, --limit <limit>", "How many recent tracks to show (max 50)", Number)
    .description("Show recently played tracks")
    .action((options) =>
      handle(async () => {
        const tracks = await getRecentTracks(parseLimit(options.limit, "limit", 50, 10));
        const text = tracks
          .map((track) => {
            const playedAt = track.playedAt ? new Date(track.playedAt).toLocaleString() : "unknown";
            return `${track.label} (${playedAt})`;
          })
          .join("\n");

        return { data: { tracks }, text: text || "No recent tracks." };
      }),
    );

  const tasteCommand = program
    .command("taste")
    .option("-l, --limit <limit>", "Items for each list (max 50)", Number)
    .description("Show what you like: top artists, top songs, recent and saved songs")
    .action((options) =>
      handle(async () => {
        const taste = await getTaste(parseLimit(options.limit, "limit", 50, 20));
        const names = (items: Array<{ name: string }>) =>
          items.map((item) => item.name).join(", ") || "none";

        const text = [
          `Top artists, last month: ${names(taste.topArtists.lastMonth)}`,
          `Top artists, all time: ${names(taste.topArtists.allTime)}`,
          `Top songs, last month:\n${numbered(taste.topTracks.lastMonth) || "  none"}`,
          `Recently played:\n${numbered(taste.recentlyPlayed) || "  none"}`,
          `Saved songs:\n${numbered(taste.savedTracks) || "  none"}`,
          ...taste.unavailable.map((gap) => `Not available: ${gap.part} (${gap.code}). ${gap.hint ?? ""}`),
        ].join("\n\n");

        return { data: taste, text };
      }),
    );

  tasteCommand
    .command("profile")
    .option("--days <days>", "Days of data for the recent lists (max 3650)", Number)
    .option("-l, --limit <limit>", "Items for each list (max 50)", Number)
    .description("What the tool learned about the user: notes, bans, loves, favourites, skips, situations, score. Read it before a set.")
    .action((options) =>
      handle(async () => {
        const profile = await buildProfile({
          days: parseLimit(options.days, "days", 3650, 180),
          limit: parseLimit(options.limit, "limit", 50, 10),
        });
        return { data: profile, text: describeProfile(profile) };
      }),
    );

  tasteCommand
    .command("note")
    .argument("<text...>", "One lesson, in plain words")
    .option("--section <name>", `Section of the notes file (default: "${DEFAULT_SECTION}")`)
    .description("Add one lesson to the taste notes file that agents read before each set")
    .action((words: string[], options) =>
      handle(async () => {
        const text = words.join(" ").trim();
        if (!text) {
          throw new SpotError("BAD_INPUT", "Give the lesson as text.");
        }

        const added = await addNote(text, options.section);
        return { data: added, text: `Added to ${added.path}:\n${added.line}` };
      }),
    );

  tasteCommand
    .command("score")
    .option("--weeks <weeks>", "How many weeks (max 104)", Number)
    .description("Skip rate of agent-selected songs for each week. If the agent learns, it goes down.")
    .action((options) =>
      handle(async () => {
        const score = weeklyScore(await readEvents(), parseLimit(options.weeks, "weeks", 104, 8));
        return { data: { score }, text: `Score by week:\n${describeScore(score)}` };
      }),
    );

  program
    .command("feel")
    .argument("<feeling>", "love, meh (play less often), ban (never play), or clear (forget the earlier word)")
    .argument("[song...]", "Song name, URI or link. With no song: the song that plays now.")
    .option("--artist", "Apply to the artist, not only the song")
    .option("--why <text>", "The user's reason, in their words")
    .description("Record what the user said about a song or an artist. Bans are enforced in sets and playlists.")
    .action((kindText: string, songWords: string[], options) =>
      handle(async () => {
        const kind = assertKind(kindText);
        const scope = options.artist ? "artist" : "song";
        let target: { uri?: string; name?: string; artists: string[]; device?: string };

        if (songWords.length > 0) {
          const input = songWords.join(" ");
          const result = await resolveNames([input], {});
          const item = result.resolved[0];
          if (!item) {
            throw new SpotError("NOT_FOUND", `Spotify found no song for "${input}".`, {
              hint: "Use the form: Artist - Title.",
              extra: { missed: result.missed },
            });
          }

          target = { uri: item.uri, name: item.name, artists: item.artists ?? [] };
        } else {
          const now = await getNow();
          if (!now.track) {
            throw new SpotError("NOT_FOUND", "Nothing plays now.", { hint: "Give the song as Artist - Title." });
          }

          target = { uri: now.track.uri, name: now.track.name, artists: now.track.artists, device: now.device?.name };
        }

        if (scope === "artist" && target.artists.length === 0) {
          throw new SpotError("BAD_INPUT", "The artist of this song is not known.", {
            hint: "Give the song as Artist - Title, not as a URI.",
          });
        }

        const feeling: Feeling = {
          at: new Date().toISOString(),
          kind,
          scope,
          ...(scope === "song" ? { uri: target.uri, name: target.name } : {}),
          artists: target.artists,
          why: options.why,
          device: target.device,
        };
        await addFeeling(feeling);

        const what = scope === "artist" ? `artist ${target.artists.join(", ")}` : `${target.name} - ${target.artists.join(", ")}`;
        const words: Record<string, string> = {
          love: "Loved",
          meh: "Marked to play less often",
          ban: "Banned. Sets and playlists will not include",
          clear: "Forgot the earlier word about",
        };
        return { data: { feeling }, text: `${words[kind]}: ${what}.` };
      }),
    );

  const historyCommand = program
    .command("history")
    .description("The listening history that the tool keeps for taste learning");

  historyCommand
    .command("import")
    .argument("<paths...>", "The unzipped Spotify data download: a folder, or Streaming_History_Audio_*.json files")
    .description("Import years of plays from a Spotify data download. Safe to run again: plays already imported are skipped.")
    .action((paths: string[]) =>
      handle(async () => {
        const result = await importHistory(paths);
        return {
          data: result,
          text: `Imported ${result.added} plays from ${result.files.length} files${result.from ? ` (${result.from.slice(0, 10)} to ${result.to?.slice(0, 10)})` : ""}. Already imported: ${result.alreadyImported}. Rows with no song: ${result.skippedRows}.`,
        };
      }),
    );

  const watchCommand = program
    .command("watch")
    .description("Record each song that plays, on all devices, for taste learning");

  watchCommand
    .command("run")
    .option("--once", "Check one time and stop")
    .description("Check what plays every 20 seconds and record each song when it ends. Runs until stopped.")
    .action((options) =>
      handle(async () => {
        if (options.once) {
          const { events, state } = await pollOnceLocked();
          return {
            data: { recorded: events, current: state.current, lastError: state.lastError },
            text: `Recorded ${events.length} songs. Now: ${state.current ? `${state.current.name} - ${state.current.artists.join(", ")}` : "nothing"}.`,
          };
        }

        await runWatch({ log: (line) => io.out(line) });
        return { data: { stopped: true }, text: "Watcher stopped." };
      }),
    );

  watchCommand
    .command("install")
    .description("macOS: start the watcher now and at each login, in the background")
    .action(() =>
      handle(async () => {
        const script = fileURLToPath(new URL("./index.js", import.meta.url));
        const result = await installLaunchAgent(script);
        return { data: result, text: `The watcher runs now and starts at each login.\n${result.path}` };
      }),
    );

  watchCommand
    .command("uninstall")
    .description("macOS: stop the background watcher and remove it")
    .action(() =>
      handle(async () => {
        const result = await uninstallLaunchAgent();
        return { data: result, text: result.removed ? "The watcher is stopped and removed." : "No watcher was installed." };
      }),
    );

  watchCommand
    .command("status")
    .description("Is the watcher running, and when did it last check?")
    .action(() =>
      handle(async () => {
        const status = await watchStatus();
        const text = [
          `Running: ${status.running ? `yes (pid ${status.pid})` : "no"}. Installed: ${status.installed ? "yes" : "no"}.`,
          `Last check: ${status.lastPollAt ?? "never"}. Songs recorded: ${status.recorded}.`,
          status.current ? `Now: ${status.current}` : "",
          status.lastError ? `Last error: ${status.lastError.code}: ${status.lastError.message}` : "",
        ].filter(Boolean).join("\n");
        return { data: status, text };
      }),
    );

  const devicesCommand = program.command("devices").description("Inspect Spotify Connect devices");

  devicesCommand
    .command("list")
    .description("List available Spotify devices")
    .action(() =>
      handle(async () => {
        const devices = await getDevices();
        const text = devices.length === 0
          ? "No active Spotify Connect devices found."
          : devices
            .map((device) => {
              const status = [
                device.is_active ? "active" : "idle",
                device.is_restricted ? "restricted" : undefined,
                device.is_private_session ? "private" : undefined,
              ]
                .filter(Boolean)
                .join(", ");

              return `${device.name} (${device.type}) id=${device.id ?? "n/a"} volume=${device.volume_percent ?? "n/a"} ${status}`;
            })
            .join("\n");

        return { data: { devices: devices.map(toDevice) }, text };
      }),
    );

  devicesCommand
    .command("transfer")
    .argument("<device>", "Device ID or exact device name")
    .option("--play", "Start playback after transfer")
    .description("Move playback to another device")
    .action((device, options) =>
      handle(async () => {
        const devices = await getDevices();
        const target = resolveDevice(devices, device);
        if (!target?.id) {
          throw new SpotError("DEVICE_NOT_FOUND", `No Spotify device matches "${device}".`, {
            hint: "Use the name or id of one of the listed devices.",
            extra: { devices: devices.map(toDevice) },
          });
        }

        await spotifyRequest("/me/player", {
          method: "PUT",
          body: {
            device_ids: [target.id],
            play: Boolean(options.play),
          },
        });

        return {
          data: { action: "transferred", device: toDevice(target) },
          text: `Transferred playback to ${target.name}.`,
        };
      }),
    );

  const playbackCommand = program.command("playback").description("Control Spotify playback");

  playbackCommand
    .command("status")
    .description("Show the current playback state")
    .action(() =>
      handle(async () => {
        const now = await getNow();
        return { data: now, text: describeNow(now) };
      }),
    );

  withDevice(
    playbackCommand
      .command("play")
      .argument("[uri]", "Optional Spotify URI or open.spotify.com URL")
      .option("--offset <offset>", "Track offset when starting a context URI", Number)
      .option("--position-ms <positionMs>", "Start position in milliseconds", Number)
      .option("--wake", "Open Spotify on this computer if no device is available")
      .description("Start or resume playback"),
  ).action((uri, options) =>
    handle(async () => {
      const result = await play({
        target: uri ? normalizeSpotifyUri(uri) : undefined,
        device: options.device,
        wake: Boolean(options.wake),
        offset: options.offset === undefined
          ? undefined
          : parseBoundedInteger(options.offset, "offset", { min: 0 }),
        positionMs: options.positionMs === undefined
          ? undefined
          : parseBoundedInteger(options.positionMs, "position", { min: 0 }),
      });

      return { data: result, text: "Playback started." };
    }),
  );

  // The simple player commands differ only in path, method and words.
  const simpleCommands: Array<[string, string, string, string, string]> = [
    ["pause", "Pause playback", "PUT", "/me/player/pause", "Playback paused."],
    ["next", "Skip to the next track", "POST", "/me/player/next", "Skipped to next track."],
    ["previous", "Skip to the previous track", "POST", "/me/player/previous", "Skipped to previous track."],
  ];

  for (const [name, description, method, path, text] of simpleCommands) {
    withDevice(playbackCommand.command(name).description(description)).action((options) =>
      handle(async () => {
        await spotifyRequest(path, {
          method,
          searchParams: { device_id: await getResolvedDeviceId(options.device) },
        });

        return { data: { action: name }, text };
      }),
    );
  }

  withDevice(
    playbackCommand
      .command("volume")
      .argument("<percent>", "Volume percentage from 0 to 100", Number)
      .description("Set playback volume"),
  ).action((percent, options) =>
    handle(async () => {
      const volume = parseBoundedInteger(percent, "volume", { min: 0, max: 100 });
      await spotifyRequest("/me/player/volume", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          volume_percent: volume,
        },
      });

      return { data: { action: "volume", volume }, text: `Volume set to ${volume}%.` };
    }),
  );

  withDevice(
    playbackCommand
      .command("seek")
      .argument("<positionMs>", "Seek position in milliseconds", Number)
      .description("Seek within the current track"),
  ).action((positionMs, options) =>
    handle(async () => {
      const position = parseBoundedInteger(positionMs, "seek position", { min: 0 });
      await spotifyRequest("/me/player/seek", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          position_ms: position,
        },
      });

      return { data: { action: "seek", positionMs: position }, text: `Seeked to ${position}ms.` };
    }),
  );

  withDevice(
    playbackCommand
      .command("shuffle")
      .argument("<state>", "on or off")
      .description("Turn shuffle on or off"),
  ).action((state, options) =>
    handle(async () => {
      const enabled = parseOnOffState(state);
      await spotifyRequest("/me/player/shuffle", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          state: enabled,
        },
      });

      return {
        data: { action: "shuffle", shuffle: enabled },
        text: `Shuffle ${enabled ? "enabled" : "disabled"}.`,
      };
    }),
  );

  withDevice(
    playbackCommand
      .command("repeat")
      .argument("<mode>", "off, track, or context")
      .description("Set repeat mode"),
  ).action((mode, options) =>
    handle(async () => {
      const repeat = String(mode).toLowerCase();
      if (!["off", "track", "context"].includes(repeat)) {
        throw new SpotError("BAD_INPUT", "Repeat mode must be one of: off, track, context.");
      }

      await spotifyRequest("/me/player/repeat", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          state: repeat,
        },
      });

      return { data: { action: "repeat", repeat }, text: `Repeat mode set to ${repeat}.` };
    }),
  );

  playbackCommand
    .command("queue")
    .description("Show the current queue")
    .action(() =>
      handle(async () => {
        const raw = await spotifyRequest<Record<string, any> | undefined>("/me/player/queue");
        const queue = (Array.isArray(raw?.queue) ? raw.queue : [])
          .map((item: Record<string, any>) => toTrack(item))
          .filter(Boolean);
        const data = { current: toTrack(raw?.currently_playing), queue };

        return {
          data,
          text: JSON.stringify(
            {
              currentlyPlaying: raw?.currently_playing
                ? formatTrackSummary(raw.currently_playing)
                : null,
              queue: queue.map((track: any) => ({ summary: track.label, uri: track.uri })),
            },
            null,
            2,
          ),
        };
      }),
    );

  withDevice(
    playbackCommand
      .command("add")
      .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
      .description("Add items to the queue"),
  ).action((uris: string[], options) =>
    handle(async () => {
      const normalized = uris.map(normalizeSpotifyUri);
      const deviceId = await getResolvedDeviceId(options.device);
      const added: string[] = [];

      // Spotify accepts one queue item for each request. The order of the requests is the queue order.
      for (const uri of normalized) {
        try {
          await spotifyRequest("/me/player/queue", {
            method: "POST",
            searchParams: { device_id: deviceId, uri },
          });
          added.push(uri);
        } catch (error) {
          // Say what is already in the queue, so a retry does not add it two times.
          if (error instanceof SpotError && added.length > 0) {
            throw new SpotError(error.code, error.message, {
              hint: error.hint,
              status: error.status,
              retryAfterSeconds: error.retryAfterSeconds,
              extra: { ...error.extra, added, notAdded: normalized.slice(added.length) },
            });
          }

          throw error;
        }
      }

      return {
        data: { action: "queued", added },
        text: added.length === 1 ? "Added item to queue." : `Added ${added.length} items to queue.`,
      };
    }),
  );

  const playlistCommand = program.command("playlist").description("Make and change playlists");

  playlistCommand
    .command("list")
    .description("List your playlists")
    .action(() =>
      handle(async () => {
        const playlists = await listPlaylists();
        const text = playlists
          .map((playlist) => `${playlist.name} (${playlist.total ?? "?"} songs) id=${playlist.id}`)
          .join("\n");

        return { data: { playlists }, text: text || "You have no playlists." };
      }),
    );

  playlistCommand
    .command("show")
    .argument("<playlist>", "Playlist name, id, URI or link")
    .description("Show a playlist and its songs (your own playlists only)")
    .action((reference) =>
      handle(async () => {
        const playlist = await getPlaylist(reference);
        return {
          data: playlist,
          text: `${playlist.name} (${playlist.tracks.length} songs) id=${playlist.id}\n${numbered(playlist.tracks)}`,
        };
      }),
    );

  withDevice(
    withSongs(
      playlistCommand
        .command("create")
        .argument("<name>", "Name of the new playlist")
        .argument("[songs...]", "Song names, URIs or links")
        .option("--description <text>", "Playlist description")
        .option("--public", "Make the playlist public. The default is private.")
        .option("--play", "Start the playlist after it is made")
        .option("--wake", "With --play: open Spotify on this computer if no device is available")
        .description("Make a playlist from a list of songs, in one step"),
    ),
  ).action((name: string, songs: string[], options) =>
    handle(async () => {
      // Songs and device are found first, so a failure does not leave an empty playlist behind.
      const found = await resolveSongs(songs, options, io, false);
      assertPlaylistItems(found.resolved.map((item) => item.uri));
      const choice = options.play
        ? await ensureDevice({ selector: options.device, wake: Boolean(options.wake) })
        : undefined;
      const playlist = await createPlaylist({
        name,
        description: options.description,
        isPublic: Boolean(options.public),
      });
      await addPlaylistItems(playlist.id, found.resolved.map((item) => item.uri));

      const data: Record<string, unknown> = {
        playlist: { ...playlist, total: found.resolved.length },
        added: found.resolved,
        missed: found.missed,
        blocked: found.blocked,
        duplicatesRemoved: found.duplicatesRemoved,
      };
      let text = `Made playlist "${playlist.name}" with ${found.resolved.length} songs. id=${playlist.id}`;

      if (choice) {
        try {
          await playOn(choice, { context_uri: playlist.uri });
          data.playing = { action: "playing", device: choice.device, woke: choice.woke };
          text += `\nPlaying "${playlist.name}"${choice.device ? ` on ${choice.device.name}` : ""}.`;
        } catch (error) {
          // The playlist exists now. Say so, or the caller tries again and makes a second one.
          data.playing = null;
          data.playError = toErrorPayload(error);
          text += `\nThe playlist was made, but it did not start: ${toErrorPayload(error).message}`;
        }
      }

      return { data, text: `${text}${describeMissed(found)}${describeBlocked(found)}` };
    }),
  );

  withSongs(
    playlistCommand
      .command("add")
      .argument("<playlist>", "Playlist name, id, URI or link")
      .argument("[songs...]", "Song names, URIs or links")
      .description("Add songs to a playlist"),
  ).action((reference: string, songs: string[], options) =>
    handle(async () => {
      const playlist = await resolvePlaylistRef(reference);
      const found = await resolveSongs(songs, options, io, true);
      await addPlaylistItems(playlist.id, found.resolved.map((item) => item.uri));

      return {
        data: {
          playlist,
          added: found.resolved,
          missed: found.missed,
          blocked: found.blocked,
          duplicatesRemoved: found.duplicatesRemoved,
        },
        text: `Added ${found.resolved.length} songs.${describeMissed(found)}${describeBlocked(found)}`,
      };
    }),
  );

  withSongs(
    playlistCommand
      .command("replace")
      .argument("<playlist>", "Playlist name, id, URI or link")
      .argument("[songs...]", "Song names, URIs or links")
      .description("Replace all songs of a playlist"),
  ).action((reference: string, songs: string[], options) =>
    handle(async () => {
      const playlist = await resolvePlaylistRef(reference);
      const found = await resolveSongs(songs, options, io, true);
      await replacePlaylistItems(playlist.id, found.resolved.map((item) => item.uri));

      return {
        data: {
          playlist,
          tracks: found.resolved,
          missed: found.missed,
          blocked: found.blocked,
          duplicatesRemoved: found.duplicatesRemoved,
        },
        text: `The playlist now has ${found.resolved.length} songs.${describeMissed(found)}${describeBlocked(found)}`,
      };
    }),
  );

  playlistCommand
    .command("remove")
    .argument("<playlist>", "Playlist name, id, URI or link")
    .argument("<uris...>", "Spotify URIs or links of the songs to remove")
    .description("Remove songs from a playlist")
    .action((reference: string, uris: string[]) =>
      handle(async () => {
        const playlist = await resolvePlaylistRef(reference);
        const removed = uris.map(normalizeSpotifyUri);
        await removePlaylistItems(playlist.id, removed);

        return { data: { playlist, removed }, text: `Removed ${removed.length} songs.` };
      }),
    );

  playlistCommand
    .command("update")
    .argument("<playlist>", "Playlist name, id, URI or link")
    .option("--name <name>", "New name")
    .option("--description <text>", "New description")
    .option("--public", "Make the playlist public")
    .option("--private", "Make the playlist private")
    .description("Change the name, description or visibility of a playlist")
    .action((reference: string, options) =>
      handle(async () => {
        const playlist = await resolvePlaylistRef(reference);
        const isPublic = options.public ? true : options.private ? false : undefined;
        await updatePlaylistDetails(playlist.id, {
          name: options.name,
          description: options.description,
          isPublic,
        });

        return { data: { playlist, updated: true }, text: "Playlist updated." };
      }),
    );

  const djCommand = program
    .command("dj")
    .description("Run a DJ set: a list of songs that plays in order and can change direction");

  withDevice(
    withSongs(
      djCommand
        .command("start")
        .argument("[songs...]", "Song names, URIs or links, in play order")
        .option("--name <name>", "Name of the set", "DJ set")
        .option("--note <text>", "The mood or the request, for example: deep focus, no vocals")
        .option("--wake", "Open Spotify on this computer if no device is available")
        .description("Write the set into the DJ playlist and start it"),
    ),
  ).action((songs: string[], options) =>
    handle(async () => {
      const found = await resolveSongs(songs, options, io, true);
      const started = await startSession({
        name: options.name,
        note: options.note,
        tracks: toSetTracks(found),
        device: options.device,
        wake: Boolean(options.wake),
      });

      const { session } = started;
      return {
        data: {
          session: {
            name: session.name,
            note: session.note,
            playlistUri: session.playlistUri,
            songs: session.tracks.length,
          },
          device: started.device,
          woke: started.woke,
          tracks: session.tracks,
          missed: found.missed,
          blocked: found.blocked,
          duplicatesRemoved: found.duplicatesRemoved,
        },
        text: `DJ set "${session.name}" started with ${session.tracks.length} songs${started.device ? ` on ${started.device.name}` : ""}.\n${numbered(session.tracks)}${describeMissed(found)}${describeBlocked(found)}`,
      };
    }),
  );

  djCommand
    .command("status")
    .description("Show the current song, and what was played, skipped and is still to come")
    .action(() =>
      handle(async () => {
        const status = await getStatus();
        return { data: status, text: describeStatus(status) };
      }),
    );

  withSongs(
    djCommand
      .command("steer")
      .argument("[songs...]", "Song names, URIs or links for the new direction")
      .description("Replace the songs that come next. The current song continues."),
  ).action((songs: string[], options) =>
    handle(async () => {
      const found = await resolveSongs(songs, options, io, true);
      const result = await steerSession(toSetTracks(found));

      return {
        data: { ...result, missed: found.missed, blocked: found.blocked, duplicatesRemoved: found.duplicatesRemoved },
        text: `Removed ${result.removed} songs that were next. Added ${result.added.length}.\n${numbered(result.added)}${describeMissed(found)}${describeBlocked(found)}`,
      };
    }),
  );

  djCommand
    .command("stop")
    .description("Pause the set and give the final report")
    .action(() =>
      handle(async () => {
        const status = await stopSession();
        return {
          data: { ...status, learn: LEARN_HINT },
          text: `${describeStatus(status)}\n\n${LEARN_HINT}`,
        };
      }),
    );

  const libraryCommand = program.command("library").description("Save or inspect library items");

  libraryCommand
    .command("save")
    .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
    .description("Save items to your library")
    .action((uris: string[]) =>
      handle(async () => {
        const saved = uris.map(normalizeSpotifyUri);
        await spotifyRequest("/me/library", {
          method: "PUT",
          body: { uris: saved },
        });

        return { data: { saved }, text: "Saved items to your library." };
      }),
    );

  libraryCommand
    .command("remove")
    .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
    .description("Remove items from your library")
    .action((uris: string[]) =>
      handle(async () => {
        const removed = uris.map(normalizeSpotifyUri);
        await spotifyRequest("/me/library", {
          method: "DELETE",
          body: { uris: removed },
        });

        return { data: { removed }, text: "Removed items from your library." };
      }),
    );

  libraryCommand
    .command("contains")
    .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
    .description("Check whether library items are saved")
    .action((uris: string[]) =>
      handle(async () => {
        const normalizedUris = uris.map(normalizeSpotifyUri);
        const result = await spotifyRequest<boolean[]>("/me/library/contains", {
          searchParams: {
            uris: normalizedUris.join(","),
          },
        });

        const items = normalizedUris.map((uri, index) => ({
          uri,
          saved: result?.[index] ?? false,
        }));

        return { data: { items }, text: JSON.stringify(items, null, 2) };
      }),
    );

  return program;
}

export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  const mode = resolveOutputMode(argv.slice(2), io);
  let exitCode = 0;

  const fail = (error: unknown): void => {
    const payload = toErrorPayload(error);
    exitCode = exitCodeFor(payload.code);

    if (mode === "json") {
      io.out(JSON.stringify({ ok: false, error: payload }));
      return;
    }

    io.err(`Error (${payload.code}): ${payload.message}`);
    if (payload.hint) {
      io.err(`Hint: ${payload.hint}`);
    }
  };

  const handle: Handle = async (action) => {
    try {
      const outcome = await action();
      io.out(
        mode === "json" && !outcome.plain
          ? JSON.stringify({ ok: true, ...outcome.data })
          : outcome.text,
      );
    } catch (error) {
      fail(error);
    }
  };

  try {
    await buildProgram(handle, io, mode).parseAsync(argv);
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      fail(error);
    } else if (error.exitCode !== 0) {
      // Help and version end with exit code 0. All other Commander errors are wrong input.
      exitCode = exitCodeFor("BAD_INPUT");
      if (mode === "json") {
        const message = error.code === "commander.help"
          ? "This command needs a subcommand."
          : error.message.replace(/^error: /, "");
        io.out(JSON.stringify({
          ok: false,
          error: { code: "BAD_INPUT", message, hint: "Run `spot --help` to see the commands." },
        }));
      }
    }
  }

  return exitCode;
}
