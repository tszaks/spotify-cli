import { vi } from "vitest";

// A small copy of the Spotify Web API that lives in memory. It uses the February 2026 paths.

export type RawTrack = {
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  duration_ms: number;
};

export type RawDevice = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  supports_volume: boolean;
  volume_percent: number;
};

export type Call = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
  token: string;
};

type FakePlaylist = {
  id: string;
  name: string;
  description: string;
  public: boolean;
  items: string[];
};

export function track(id: string, name: string, artist: string, album = "Album"): RawTrack {
  return {
    uri: `spotify:track:${id}`,
    name,
    artists: artist.split(", ").map((part) => ({ name: part })),
    album: { name: album },
    duration_ms: 200_000,
  };
}

export function device(id: string, name: string, active = false, type = "Computer"): RawDevice {
  return {
    id,
    name,
    type,
    is_active: active,
    is_private_session: false,
    is_restricted: false,
    supports_volume: true,
    volume_percent: 50,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function apiError(status: number, message: string, reason?: string): Response {
  return json(status, { error: { status, message, ...(reason ? { reason } : {}) } });
}

const words = (text: string): string[] =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

export class FakeSpotify {
  catalog: RawTrack[] = [];

  artists: Array<{ uri: string; name: string }> = [];

  albums: Array<{ uri: string; name: string; artists: Array<{ name: string }> }> = [];

  devices: RawDevice[] = [];

  player: {
    context_uri?: string;
    item?: RawTrack;
    is_playing: boolean;
    shuffle: boolean;
    repeat: string;
    progress_ms: number;
  } | null = null;

  queue: string[] = [];

  playlists = new Map<string, FakePlaylist>();

  recent: Array<{ track: RawTrack; played_at: string }> = [];

  topArtists: Array<{ uri: string; name: string }> = [];

  topTracks: RawTrack[] = [];

  saved: RawTrack[] = [];

  // False copies a login that does not have the user-top-read permission.
  topScope = true;

  // When set, each API call with a different token gets 401.
  validToken: string | undefined;

  refreshes = 0;

  calls: Call[] = [];

  // A function here can answer a request before the normal routes. Return undefined to pass.
  intercept: ((call: Call) => Response | undefined) | undefined;

  install(): this {
    vi.stubGlobal("fetch", this.fetch);
    return this;
  }

  callsTo(method: string, path: string | RegExp): Call[] {
    return this.calls.filter(
      (call) => call.method === method && (typeof path === "string" ? call.path === path : path.test(call.path)),
    );
  }

  addPlaylist(name: string, uris: string[] = []): FakePlaylist {
    const id = `PL${String(this.playlists.size + 1).padStart(20, "0")}`;
    const playlist = { id, name, description: "", public: false, items: [...uris] };
    this.playlists.set(id, playlist);
    return playlist;
  }

  find(uri: string): RawTrack {
    const found = this.catalog.find((item) => item.uri === uri);
    if (!found) {
      throw new Error(`Fake catalog has no ${uri}`);
    }

    return found;
  }

  private rawPlaylist(playlist: FakePlaylist): Record<string, unknown> {
    return {
      id: playlist.id,
      uri: `spotify:playlist:${playlist.id}`,
      name: playlist.name,
      description: playlist.description,
      public: playlist.public,
      collaborative: false,
      owner: { id: "tester", display_name: "Tester" },
      items: { total: playlist.items.length },
    };
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";

    if (url.hostname === "accounts.spotify.com") {
      this.refreshes += 1;
      this.validToken = this.validToken === undefined ? undefined : `access-${this.refreshes}`;
      return json(200, {
        access_token: `access-${this.refreshes}`,
        refresh_token: `refresh-${this.refreshes}`,
        expires_in: 3600,
        scope: "test",
        token_type: "Bearer",
      });
    }

    if (url.hostname !== "api.spotify.com") {
      throw new Error(`Fake Spotify got a request for ${url.hostname}`);
    }

    const headers = new Headers(init.headers);
    const call: Call = {
      method,
      path: url.pathname.replace(/^\/v1/, ""),
      query: Object.fromEntries(url.searchParams),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      token: (headers.get("authorization") ?? "").replace("Bearer ", ""),
    };
    this.calls.push(call);

    if (this.validToken !== undefined && call.token !== this.validToken) {
      return apiError(401, "The access token expired");
    }

    return this.intercept?.(call) ?? this.route(call);
  };

  private route(call: Call): Response {
    const { method, path, query, body } = call;
    const active = this.devices.find((item) => item.is_active);
    const key = `${method} ${path}`;

    const trackMatch = path.match(/^\/tracks\/([^/]+)$/);
    if (trackMatch && method === "GET") {
      const found = this.catalog.find((item) => item.uri === `spotify:track:${trackMatch[1]}`);
      return found ? json(200, found) : apiError(404, "Non existing id");
    }

    const playlistMatch = path.match(/^\/playlists\/([^/]+)(\/items)?$/);
    if (playlistMatch) {
      const playlist = this.playlists.get(playlistMatch[1]);
      if (!playlist) {
        return apiError(404, "Resource not found");
      }

      if (!playlistMatch[2]) {
        if (method === "PUT") {
          playlist.name = body.name ?? playlist.name;
          playlist.description = body.description ?? playlist.description;
          playlist.public = body.public ?? playlist.public;
          return new Response(null, { status: 200 });
        }

        return json(200, this.rawPlaylist(playlist));
      }

      if (method === "GET") {
        const limit = Number(query.limit ?? 20);
        const offset = Number(query.offset ?? 0);
        const page = playlist.items.slice(offset, offset + limit);
        return json(200, {
          items: page.map((uri) => ({ added_at: "2026-11-01T00:00:00Z", item: this.find(uri) })),
          total: playlist.items.length,
          next: offset + limit < playlist.items.length ? "more" : null,
        });
      }

      const uris: string[] = method === "DELETE"
        ? (body?.items ?? []).map((item: { uri: string }) => item.uri)
        : body?.uris ?? [];
      if (uris.length > 100) {
        return apiError(400, "Too many items. Maximum is 100.");
      }

      if (method === "POST") {
        playlist.items.push(...uris);
        return json(201, { snapshot_id: "snap" });
      }

      if (method === "PUT") {
        playlist.items = [...uris];
        return json(200, { snapshot_id: "snap" });
      }

      playlist.items = playlist.items.filter((uri) => !uris.includes(uri));
      return json(200, { snapshot_id: "snap" });
    }

    switch (key) {
      case "GET /me":
        return json(200, { id: "tester", display_name: "Tester", uri: "spotify:user:tester" });

      case "GET /search": {
        const limit = Number(query.limit ?? 5);
        if (limit > 10) {
          return apiError(400, "Invalid limit");
        }

        const wanted = words(query.q ?? "");
        const text = (item: RawTrack) =>
          words(`${item.name} ${item.artists.map((artist) => artist.name).join(" ")}`);
        const all = this.catalog.filter((item) => wanted.every((word) => text(item).includes(word)));
        // Real Spotify gives loosely related songs when nothing fits. The fake does the same.
        const some = this.catalog.filter((item) => wanted.some((word) => text(item).includes(word)));
        const result: Record<string, unknown> = {};

        for (const type of (query.type ?? "").split(",")) {
          if (type === "track") {
            result.tracks = { items: (all.length > 0 ? all : some).slice(0, limit) };
          } else if (type === "artist") {
            result.artists = {
              items: this.artists
                .filter((artist) => wanted.every((word) => words(artist.name).includes(word)))
                .slice(0, limit),
            };
          } else if (type === "album") {
            result.albums = {
              items: this.albums
                .filter((album) => wanted.some((word) => words(album.name).includes(word)))
                .slice(0, limit),
            };
          } else if (type === "playlist") {
            // Spotify puts null in playlist results for removed playlists.
            result.playlists = { items: [null] };
          }
        }

        return json(200, result);
      }

      case "GET /me/player/devices":
        return json(200, { devices: this.devices });

      case "GET /me/player":
        if (!active || !this.player) {
          return new Response(null, { status: 204 });
        }

        return json(200, {
          device: active,
          is_playing: this.player.is_playing,
          progress_ms: this.player.progress_ms,
          shuffle_state: this.player.shuffle,
          repeat_state: this.player.repeat,
          item: this.player.item ?? null,
          context: this.player.context_uri
            ? { type: this.player.context_uri.split(":")[1], uri: this.player.context_uri }
            : null,
        });

      case "PUT /me/player": {
        const target = this.devices.find((item) => item.id === body.device_ids[0]);
        if (!target) {
          return apiError(404, "Device not found");
        }

        this.devices.forEach((item) => {
          item.is_active = item === target;
        });
        return new Response(null, { status: 204 });
      }

      case "PUT /me/player/play": {
        const target = query.device_id
          ? this.devices.find((item) => item.id === query.device_id)
          : active;
        if (!target) {
          return apiError(404, "Player command failed: No active device found", "NO_ACTIVE_DEVICE");
        }

        this.devices.forEach((item) => {
          item.is_active = item === target;
        });

        const previous = this.player;
        const playlistId = body?.context_uri?.split(":")[2];
        const playlist = playlistId ? this.playlists.get(playlistId) : undefined;
        const firstUri = playlist ? playlist.items[body.offset?.position ?? 0] : body?.uris?.[0];
        this.player = {
          context_uri: body?.context_uri ?? (body ? undefined : previous?.context_uri),
          item: firstUri ? this.find(firstUri) : previous?.item,
          is_playing: true,
          shuffle: previous?.shuffle ?? true,
          repeat: previous?.repeat ?? "off",
          progress_ms: body?.position_ms ?? 0,
        };
        return new Response(null, { status: 204 });
      }

      case "PUT /me/player/pause":
        if (!active || !this.player) {
          return apiError(404, "Player command failed: No active device found", "NO_ACTIVE_DEVICE");
        }

        if (!this.player.is_playing) {
          return apiError(403, "Player command failed: Restriction violated", "UNKNOWN");
        }

        this.player.is_playing = false;
        return new Response(null, { status: 204 });

      case "POST /me/player/next":
      case "POST /me/player/previous":
        // Real Spotify sometimes sends text that is not JSON with a success status.
        return new Response("3f9a", { status: 200 });

      case "PUT /me/player/volume":
      case "PUT /me/player/seek":
      case "PUT /me/player/repeat":
        return new Response(null, { status: 204 });

      case "PUT /me/player/shuffle":
        if (this.player) {
          this.player.shuffle = query.state === "true";
        }

        return new Response(null, { status: 204 });

      case "GET /me/player/queue":
        return json(200, {
          currently_playing: this.player?.item ?? null,
          queue: this.queue.map((uri) => this.find(uri)),
        });

      case "POST /me/player/queue":
        if (!active) {
          return apiError(404, "Player command failed: No active device found", "NO_ACTIVE_DEVICE");
        }

        this.queue.push(query.uri);
        return new Response(null, { status: 204 });

      case "GET /me/player/recently-played": {
        const after = Number(query.after ?? 0);
        const items = this.recent
          .filter((entry) => Date.parse(entry.played_at) > after)
          .slice(0, Number(query.limit ?? 20));
        return json(200, { items });
      }

      case "GET /me/playlists": {
        const limit = Number(query.limit ?? 20);
        const offset = Number(query.offset ?? 0);
        const all = [...this.playlists.values()];
        return json(200, {
          items: all.slice(offset, offset + limit).map((playlist) => this.rawPlaylist(playlist)),
          total: all.length,
          next: offset + limit < all.length ? "more" : null,
        });
      }

      case "POST /me/playlists": {
        const playlist = this.addPlaylist(body.name);
        playlist.description = body.description ?? "";
        playlist.public = body.public ?? true;
        return json(201, this.rawPlaylist(playlist));
      }

      case "GET /me/top/artists":
        return this.topScope
          ? json(200, { items: this.topArtists })
          : apiError(403, "Insufficient client scope");

      case "GET /me/top/tracks":
        return this.topScope
          ? json(200, { items: this.topTracks })
          : apiError(403, "Insufficient client scope");

      case "GET /me/tracks":
        return json(200, { items: this.saved.map((item) => ({ track: item })) });

      case "PUT /me/library":
      case "DELETE /me/library":
        return new Response(null, { status: 200 });

      case "GET /me/library/contains":
        return json(200, (query.uris ?? "").split(",").map((uri) => this.saved.some((item) => item.uri === uri)));

      default:
        return apiError(404, `Fake Spotify has no route for ${key}`);
    }
  }
}
