#!/usr/bin/env node

import { Command } from "commander";
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
  setRedirectUri,
} from "./config-store.js";
import {
  parseBoundedInteger,
  parseOnOffState,
} from "./input-validation.js";
import {
  formatSearchItemSummary,
  formatTrackSummary,
  printHeading,
  printJson,
} from "./output.js";
import {
  normalizeSearchLimit,
  resolveDevice,
  type SpotifyDevice,
} from "./playback-utils.js";
import {
  buildAuthorizationUrl,
  clearStoredTokens,
  completeAuthorizationWithCode,
  getStoredTokens,
  spotifyRequest,
  type SpotifyApiError,
} from "./spotify-client.js";
import { normalizeSpotifyUri, isContextUri } from "./spotify-uri.js";

type SpotifyProfile = {
  display_name?: string;
  id: string;
};

type PlaybackState = {
  device: SpotifyDevice;
  is_playing: boolean;
  progress_ms: number | null;
  repeat_state: string;
  shuffle_state: boolean;
  item: Record<string, any> | null;
  context?: {
    type?: string;
    uri?: string;
  } | null;
};

const program = new Command();

program
  .name("spot")
  .description("Control Spotify from the command line")
  .version("1.1.0");

async function runWithHandling(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const apiError = error as SpotifyApiError;

    if (apiError?.name === "SpotifyApiError") {
      console.error(`Spotify API error (${apiError.status}): ${apiError.message}`);
      if (apiError.details) {
        printJson(apiError.details);
      }
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    process.exitCode = 1;
  }
}

async function getDevices(): Promise<SpotifyDevice[]> {
  const data = await spotifyRequest<{ devices: SpotifyDevice[] }>("/me/player/devices");
  return data.devices;
}

async function getResolvedDeviceId(selector?: string): Promise<string | undefined> {
  if (!selector) {
    return undefined;
  }

  const device = resolveDevice(await getDevices(), selector);

  if (!device?.id) {
    throw new Error(`No Spotify device matched "${selector}".`);
  }

  return device.id;
}

function printSearchResults(data: Record<string, any>): void {
  for (const [type, payload] of Object.entries(data)) {
    const items = Array.isArray((payload as Record<string, any>).items)
      ? (payload as Record<string, any>).items.filter(Boolean)
      : [];

    printHeading(type);
    if (items.length === 0) {
      console.log("No results.");
      continue;
    }

    for (const item of items) {
      console.log(`${formatSearchItemSummary(item)} (${item.uri})`);
    }
  }
}

const configCommand = program.command("config").description("Manage local CLI config");

configCommand
  .command("set-client-id")
  .argument("<clientId>", "Spotify application client ID")
  .description("Store the Spotify client ID locally")
  .action((clientId) =>
    runWithHandling(async () => {
      await setClientId(clientId);
      console.log("Stored Spotify client ID.");
    }),
  );

configCommand
  .command("set-redirect-uri")
  .argument("<redirectUri>", "Redirect URI allowlisted in your Spotify app")
  .description("Override the default local callback URL")
  .action((redirectUri) =>
    runWithHandling(async () => {
      await setRedirectUri(redirectUri);
      console.log("Stored redirect URI.");
    }),
  );

configCommand
  .command("show")
  .description("Show the current resolved config")
  .action(() =>
    runWithHandling(async () => {
      const rawConfig = await readConfig();
      let resolvedConfig:
        | {
          clientId: string;
          redirectUri: string;
        }
        | undefined;

      try {
        resolvedConfig = await getResolvedConfig();
      } catch {
        resolvedConfig = undefined;
      }

      printJson({
        stored: rawConfig,
        resolved: resolvedConfig
          ? {
            ...resolvedConfig,
            clientId: `${resolvedConfig.clientId.slice(0, 6)}...`,
          }
          : {
            clientId: null,
            redirectUri: rawConfig.redirectUri ?? null,
          },
      });
    }),
  );

const authCommand = program.command("auth").description("Spotify login helpers");

authCommand
  .command("login")
  .option("--client-id <clientId>", "Store a client ID before starting login")
  .option("--redirect-uri <redirectUri>", "Override and store the redirect URI before starting login")
  .description("Log into Spotify with PKCE in your browser")
  .action((options) =>
    runWithHandling(async () => {
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

      console.log("Opening Spotify authorization in your browser...");
      console.log(`After Spotify redirects, copy the full final URL and run:\nspot auth finish '<redirected-url>'\n`);
      console.log(`Authorization URL:\n${authUrl}\n`);

      try {
        await open(authUrl);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`Automatic browser launch failed: ${reason}`);
      }
    }),
  );

authCommand
  .command("finish")
  .argument("<callbackUrl>", "The full redirect URL after Spotify authorization")
  .description("Finish a pending Spotify login using the redirected callback URL")
  .action((callbackUrl) =>
    runWithHandling(async () => {
      const session = await readAuthSession();
      if (!session) {
        throw new Error("No pending Spotify auth session found. Run `spot auth login` first.");
      }

      const code = parseAuthorizationCallbackUrl(callbackUrl, session.state);
      const tokens = await completeAuthorizationWithCode(session.codeVerifier, code);
      await deleteAuthSession();
      console.log(`Connected. Token expires at ${new Date(tokens.expiresAt).toLocaleString()}.`);
    }),
  );

authCommand
  .command("status")
  .description("Show whether the CLI is connected")
  .action(() =>
    runWithHandling(async () => {
      const tokens = await getStoredTokens();
      if (!tokens) {
        console.log("Not connected.");
        return;
      }

      const profile = await spotifyRequest<SpotifyProfile>("/me");
      printJson({
        connected: true,
        user: profile.display_name ?? profile.id,
        expiresAt: new Date(tokens.expiresAt).toISOString(),
        scope: tokens.scope,
      });
    }),
  );

authCommand
  .command("logout")
  .description("Clear the saved Spotify token")
  .action(() =>
    runWithHandling(async () => {
      await clearStoredTokens();
      console.log("Removed stored Spotify tokens.");
    }),
  );

program
  .command("me")
  .description("Show the current Spotify account")
  .action(() =>
    runWithHandling(async () => {
      printJson(await spotifyRequest("/me"));
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
    runWithHandling(async () => {
      if (options.limit !== undefined && !Number.isFinite(options.limit)) {
        throw new Error("limit must be a number.");
      }

      const limit = normalizeSearchLimit(options.limit);
      const types = String(options.type)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .join(",");

      const results = await spotifyRequest<Record<string, any>>("/search", {
        searchParams: {
          q: query,
          type: types,
          limit,
        },
      });

      printSearchResults(results);
    }),
  );

program
  .command("recent")
  .option("-l, --limit <limit>", "How many recent tracks to show", Number)
  .description("Show recently played tracks")
  .action((options) =>
    runWithHandling(async () => {
      if (options.limit !== undefined && !Number.isFinite(options.limit)) {
        throw new Error("limit must be a number.");
      }

      const limit = normalizeSearchLimit(options.limit);
      const results = await spotifyRequest<{ items: Array<Record<string, any>> }>(
        "/me/player/recently-played",
        {
          searchParams: {
            limit,
          },
        },
      );

      for (const item of results.items) {
        const playedAt = item.played_at ? new Date(item.played_at).toLocaleString() : "unknown";
        console.log(`${formatTrackSummary(item.track)} (${playedAt})`);
      }
    }),
  );

const devicesCommand = program.command("devices").description("Inspect Spotify Connect devices");

devicesCommand
  .command("list")
  .description("List available Spotify devices")
  .action(() =>
    runWithHandling(async () => {
      const devices = await getDevices();
      if (devices.length === 0) {
        console.log("No active Spotify Connect devices found.");
        return;
      }

      for (const device of devices) {
        const status = [
          device.is_active ? "active" : "idle",
          device.is_restricted ? "restricted" : undefined,
          device.is_private_session ? "private" : undefined,
        ]
          .filter(Boolean)
          .join(", ");

        console.log(
          `${device.name} (${device.type}) id=${device.id ?? "n/a"} volume=${device.volume_percent ?? "n/a"} ${status}`,
        );
      }
    }),
  );

devicesCommand
  .command("transfer")
  .argument("<device>", "Device ID or exact device name")
  .option("--play", "Start playback after transfer")
  .description("Move playback to another device")
  .action((device, options) =>
    runWithHandling(async () => {
      const target = resolveDevice(await getDevices(), device);
      if (!target?.id) {
        throw new Error(`No Spotify device matched "${device}".`);
      }

      await spotifyRequest("/me/player", {
        method: "PUT",
        body: {
          device_ids: [target.id],
          play: Boolean(options.play),
        },
      });

      console.log(`Transferred playback to ${target.name}.`);
    }),
  );

const playbackCommand = program.command("playback").description("Control Spotify playback");

playbackCommand
  .command("status")
  .description("Show the current playback state")
  .action(() =>
    runWithHandling(async () => {
      const playback = await spotifyRequest<PlaybackState | null>("/me/player");
      if (!playback) {
        console.log("Nothing is currently active on Spotify Connect.");
        return;
      }

      printJson({
        device: playback.device,
        isPlaying: playback.is_playing,
        progressMs: playback.progress_ms,
        repeat: playback.repeat_state,
        shuffle: playback.shuffle_state,
        context: playback.context,
        track: playback.item,
        summary: formatTrackSummary(playback.item),
      });
    }),
  );

playbackCommand
  .command("play")
  .argument("[uri]", "Optional Spotify URI or open.spotify.com URL")
  .option("-d, --device <device>", "Target device ID or exact name")
  .option("--offset <offset>", "Track offset when starting a context URI", Number)
  .option("--position-ms <positionMs>", "Start position in milliseconds", Number)
  .description("Start or resume playback")
  .action((uri, options) =>
    runWithHandling(async () => {
      const deviceId = await getResolvedDeviceId(options.device);
      const body: Record<string, any> = {};
      const offset = options.offset === undefined
        ? undefined
        : parseBoundedInteger(options.offset, "offset", { min: 0 });
      const positionMs = options.positionMs === undefined
        ? undefined
        : parseBoundedInteger(options.positionMs, "position", { min: 0 });

      if (uri) {
        const normalizedUri = normalizeSpotifyUri(uri);
        if (isContextUri(normalizedUri)) {
          body.context_uri = normalizedUri;
          if (offset !== undefined) {
            body.offset = { position: offset };
          }
        } else {
          body.uris = [normalizedUri];
        }
      }

      if (positionMs !== undefined) {
        body.position_ms = positionMs;
      }

      await spotifyRequest("/me/player/play", {
        method: "PUT",
        searchParams: { device_id: deviceId },
        body: Object.keys(body).length > 0 ? body : undefined,
      });

      console.log("Playback started.");
    }),
  );

playbackCommand
  .command("pause")
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Pause playback")
  .action((options) =>
    runWithHandling(async () => {
      await spotifyRequest("/me/player/pause", {
        method: "PUT",
        searchParams: { device_id: await getResolvedDeviceId(options.device) },
      });
      console.log("Playback paused.");
    }),
  );

playbackCommand
  .command("next")
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Skip to the next track")
  .action((options) =>
    runWithHandling(async () => {
      await spotifyRequest("/me/player/next", {
        method: "POST",
        searchParams: { device_id: await getResolvedDeviceId(options.device) },
      });
      console.log("Skipped to next track.");
    }),
  );

playbackCommand
  .command("previous")
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Skip to the previous track")
  .action((options) =>
    runWithHandling(async () => {
      await spotifyRequest("/me/player/previous", {
        method: "POST",
        searchParams: { device_id: await getResolvedDeviceId(options.device) },
      });
      console.log("Skipped to previous track.");
    }),
  );

playbackCommand
  .command("volume")
  .argument("<percent>", "Volume percentage from 0 to 100", Number)
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Set playback volume")
  .action((percent, options) =>
    runWithHandling(async () => {
      const clampedPercent = parseBoundedInteger(percent, "volume", {
        min: 0,
        max: 100,
      });
      await spotifyRequest("/me/player/volume", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          volume_percent: clampedPercent,
        },
      });
      console.log(`Volume set to ${clampedPercent}%.`);
    }),
  );

playbackCommand
  .command("seek")
  .argument("<positionMs>", "Seek position in milliseconds", Number)
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Seek within the current track")
  .action((positionMs, options) =>
    runWithHandling(async () => {
      const seekPosition = parseBoundedInteger(positionMs, "seek position", {
        min: 0,
      });
      await spotifyRequest("/me/player/seek", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          position_ms: seekPosition,
        },
      });
      console.log(`Seeked to ${seekPosition}ms.`);
    }),
  );

playbackCommand
  .command("shuffle")
  .argument("<state>", "on or off")
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Turn shuffle on or off")
  .action((state, options) =>
    runWithHandling(async () => {
      const enabled = parseOnOffState(state);
      await spotifyRequest("/me/player/shuffle", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          state: enabled,
        },
      });
      console.log(`Shuffle ${enabled ? "enabled" : "disabled"}.`);
    }),
  );

playbackCommand
  .command("repeat")
  .argument("<mode>", "off, track, or context")
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Set repeat mode")
  .action((mode, options) =>
    runWithHandling(async () => {
      const normalizedMode = String(mode).toLowerCase();
      if (!["off", "track", "context"].includes(normalizedMode)) {
        throw new Error("Repeat mode must be one of: off, track, context.");
      }

      await spotifyRequest("/me/player/repeat", {
        method: "PUT",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          state: normalizedMode,
        },
      });
      console.log(`Repeat mode set to ${normalizedMode}.`);
    }),
  );

playbackCommand
  .command("queue")
  .description("Show the current queue")
  .action(() =>
    runWithHandling(async () => {
      const data = await spotifyRequest<Record<string, any>>("/me/player/queue");
      printJson({
        currentlyPlaying: data.currently_playing
          ? formatTrackSummary(data.currently_playing)
          : null,
        queue: Array.isArray(data.queue)
          ? data.queue.map((item) => ({
            summary: formatTrackSummary(item),
            uri: item.uri,
          }))
          : [],
      });
    }),
  );

playbackCommand
  .command("add")
  .argument("<uri>", "Spotify URI or open.spotify.com URL")
  .option("-d, --device <device>", "Target device ID or exact name")
  .description("Add an item to the queue")
  .action((uri, options) =>
    runWithHandling(async () => {
      await spotifyRequest("/me/player/queue", {
        method: "POST",
        searchParams: {
          device_id: await getResolvedDeviceId(options.device),
          uri: normalizeSpotifyUri(uri),
        },
      });
      console.log("Added item to queue.");
    }),
  );

const libraryCommand = program.command("library").description("Save or inspect library items");

libraryCommand
  .command("save")
  .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
  .description("Save items to your library")
  .action((uris: string[]) =>
    runWithHandling(async () => {
      await spotifyRequest("/me/library", {
        method: "PUT",
        body: { uris: uris.map(normalizeSpotifyUri) },
      });
      console.log("Saved items to your library.");
    }),
  );

libraryCommand
  .command("remove")
  .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
  .description("Remove items from your library")
  .action((uris: string[]) =>
    runWithHandling(async () => {
      await spotifyRequest("/me/library", {
        method: "DELETE",
        body: { uris: uris.map(normalizeSpotifyUri) },
      });
      console.log("Removed items from your library.");
    }),
  );

libraryCommand
  .command("contains")
  .argument("<uri...>", "One or more Spotify URIs or open.spotify.com URLs")
  .description("Check whether library items are saved")
  .action((uris: string[]) =>
    runWithHandling(async () => {
      const normalizedUris = uris.map(normalizeSpotifyUri);
      const result = await spotifyRequest<boolean[]>("/me/library/contains", {
        searchParams: {
          uris: normalizedUris.join(","),
        },
      });

      printJson(
        normalizedUris.map((uri, index) => ({
          uri,
          saved: result[index] ?? false,
        })),
      );
    }),
  );

program.parseAsync(process.argv);
