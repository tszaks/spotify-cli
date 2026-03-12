import { URL } from "node:url";

import { getResolvedConfig } from "./config-store.js";
import { createCodeChallenge, generateCodeVerifier } from "./pkce.js";
import { TOKEN_PATH } from "./paths.js";
import {
  deleteTokenStore,
  isTokenExpired,
  readTokenStore,
  type SpotifyTokenSet,
  writeTokenStore,
} from "./token-store.js";

const API_BASE_URL = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const REQUIRED_SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-follow-read",
  "user-follow-modify",
  "user-library-read",
  "user-library-modify",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
];

export class SpotifyApiError extends Error {
  status: number;

  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.details = details;
  }
}

export async function clearStoredTokens(): Promise<void> {
  await deleteTokenStore(TOKEN_PATH);
}

export async function getStoredTokens(): Promise<SpotifyTokenSet | null> {
  return readTokenStore(TOKEN_PATH);
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<SpotifyTokenSet> {
  const { clientId, redirectUri } = await getResolvedConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const json = (await response.json()) as Record<string, any>;

  if (!response.ok) {
    throw new SpotifyApiError(
      response.status,
      json.error_description ?? json.error ?? "Spotify token exchange failed.",
      json,
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    scope: json.scope ?? "",
    tokenType: json.token_type ?? "Bearer",
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  };
}

async function refreshAccessToken(tokens: SpotifyTokenSet): Promise<SpotifyTokenSet> {
  const { clientId } = await getResolvedConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  const json = (await response.json()) as Record<string, any>;

  if (!response.ok) {
    throw new SpotifyApiError(
      response.status,
      json.error_description ?? json.error ?? "Spotify token refresh failed.",
      json,
    );
  }

  const nextTokens: SpotifyTokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    scope: json.scope ?? tokens.scope,
    tokenType: json.token_type ?? tokens.tokenType,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  };

  await writeTokenStore(TOKEN_PATH, nextTokens);
  return nextTokens;
}

async function getValidTokens(): Promise<SpotifyTokenSet> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    throw new Error("No Spotify login found. Run `spot auth login` first.");
  }

  if (isTokenExpired(tokens.expiresAt)) {
    return refreshAccessToken(tokens);
  }

  return tokens;
}

export async function spotifyRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, any> | undefined;
    searchParams?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> {
  const tokens = await getValidTokens();
  const url = new URL(`${API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let json: unknown;
  const text = await response.text();
  json = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const errorMessage =
      typeof json === "object" && json !== null && "error" in json
        ? ((json as Record<string, any>).error?.message
          ?? (json as Record<string, any>).error
          ?? "Spotify API request failed.")
        : "Spotify API request failed.";

    throw new SpotifyApiError(response.status, errorMessage, json);
  }

  return json as T;
}

export async function buildAuthorizationUrl(): Promise<{
  authUrl: string;
  codeVerifier: string;
  state: string;
}> {
  const { clientId, redirectUri } = await getResolvedConfig();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = generateCodeVerifier(48);

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    state,
  }).toString();

  return {
    authUrl: authUrl.toString(),
    codeVerifier,
    state,
  };
}

export async function completeAuthorizationWithCode(
  codeVerifier: string,
  code: string,
): Promise<SpotifyTokenSet> {
  const tokens = await exchangeAuthorizationCode(code, codeVerifier);
  await writeTokenStore(TOKEN_PATH, tokens);
  return tokens;
}
