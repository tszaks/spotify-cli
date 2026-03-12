export function normalizeSpotifyUri(input: string): string {
  if (input.startsWith("spotify:")) {
    return input;
  }

  if (input.startsWith("https://open.spotify.com/")) {
    const url = new URL(input);
    const [, type, id] = url.pathname.split("/");

    if (!type || !id) {
      throw new Error(`Unsupported Spotify URL: ${input}`);
    }

    return `spotify:${type}:${id}`;
  }

  throw new Error(
    `Unsupported Spotify identifier: ${input}. Use a spotify: URI or an open.spotify.com URL.`,
  );
}

export function isContextUri(uri: string): boolean {
  return uri.startsWith("spotify:album:")
    || uri.startsWith("spotify:artist:")
    || uri.startsWith("spotify:playlist:");
}
