// Small, stable shapes for output. Spotify's full objects are large and change often.

export type Track = {
  name: string;
  artists: string[];
  album?: string;
  uri: string;
  durationMs?: number;
  label: string;
};

export type Device = {
  id: string | null;
  name: string;
  type: string;
  active: boolean;
  volume: number | null;
  restricted: boolean;
};

export type Playlist = {
  id: string;
  uri: string;
  name: string;
  owner?: string;
  public: boolean | null;
  collaborative: boolean;
  total: number | null;
  description?: string;
};

export function toTrack(raw: Record<string, any> | null | undefined): Track | null {
  if (!raw || typeof raw.uri !== "string") {
    return null;
  }

  const artists: string[] = Array.isArray(raw.artists)
    ? raw.artists
      .map((artist: { name?: unknown }) => artist?.name)
      .filter((name: unknown): name is string => typeof name === "string")
    : [];
  // An episode has a show in place of artists.
  const by = artists.length > 0 ? artists : typeof raw.show?.name === "string" ? [raw.show.name] : [];
  const name = typeof raw.name === "string" ? raw.name : "Unknown";

  return {
    name,
    artists: by,
    album: raw.album?.name,
    uri: raw.uri,
    durationMs: raw.duration_ms,
    label: by.length > 0 ? `${name} - ${by.join(", ")}` : name,
  };
}

export function toDevice(raw: Record<string, any>): Device {
  return {
    id: raw.id ?? null,
    name: raw.name,
    type: raw.type,
    active: Boolean(raw.is_active),
    volume: raw.volume_percent ?? null,
    restricted: Boolean(raw.is_restricted),
  };
}

export function toPlaylist(raw: Record<string, any>): Playlist {
  return {
    id: raw.id,
    uri: raw.uri ?? `spotify:playlist:${raw.id}`,
    name: raw.name,
    owner: raw.owner?.display_name ?? raw.owner?.id,
    public: raw.public ?? null,
    collaborative: Boolean(raw.collaborative),
    // Spotify renamed `tracks` to `items` in February 2026. Old replies still use `tracks`.
    total: raw.items?.total ?? raw.tracks?.total ?? null,
    description: raw.description || undefined,
  };
}
