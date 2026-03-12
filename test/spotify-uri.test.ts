import { describe, expect, it } from "vitest";

import { isContextUri, normalizeSpotifyUri } from "../src/spotify-uri.js";

describe("spotify uri normalization", () => {
  it("keeps native spotify uris unchanged", () => {
    expect(normalizeSpotifyUri("spotify:track:123")).toBe("spotify:track:123");
  });

  it("converts open.spotify.com urls into spotify uris", () => {
    expect(
      normalizeSpotifyUri(
        "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123",
      ),
    ).toBe("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
  });
});

describe("context uri detection", () => {
  it("marks playlist, album, and artist uris as context uris", () => {
    expect(isContextUri("spotify:playlist:123")).toBe(true);
    expect(isContextUri("spotify:album:123")).toBe(true);
    expect(isContextUri("spotify:artist:123")).toBe(true);
    expect(isContextUri("spotify:track:123")).toBe(false);
  });
});
