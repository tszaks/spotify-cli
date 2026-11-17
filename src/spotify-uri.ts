import { SpotError } from "./errors.js";

export function isSpotifyRef(input: string): boolean {
  return input.startsWith("spotify:") || input.startsWith("https://open.spotify.com/");
}

export function normalizeSpotifyUri(input: string): string {
  if (input.startsWith("spotify:")) {
    return input;
  }

  if (input.startsWith("https://open.spotify.com/")) {
    const url = new URL(input);
    // Shared links can start with a language part, for example /intl-de/track/<id>.
    const segments = url.pathname.split("/").filter((segment) => segment && !/^intl-/.test(segment));
    const [type, id] = segments;

    if (!type || !id) {
      throw new SpotError("BAD_INPUT", `Unsupported Spotify URL: ${input}`);
    }

    return `spotify:${type}:${id}`;
  }

  throw new SpotError(
    "BAD_INPUT",
    `Unsupported Spotify identifier: ${input}. Use a spotify: URI or an open.spotify.com URL.`,
  );
}

export function isContextUri(uri: string): boolean {
  return uri.startsWith("spotify:album:")
    || uri.startsWith("spotify:artist:")
    || uri.startsWith("spotify:playlist:");
}

export function isQueueableUri(uri: string): boolean {
  return uri.startsWith("spotify:track:") || uri.startsWith("spotify:episode:");
}
