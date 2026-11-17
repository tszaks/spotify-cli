import { URL } from "node:url";

import { getResolvedConfig } from "./config-store.js";
import { LOGIN_HINT, parseJson, SpotError, spotifyHttpError } from "./errors.js";
import { createCodeChallenge, generateCodeVerifier } from "./pkce.js";
import { TOKEN_LOCK_PATH, TOKEN_PATH } from "./paths.js";
import { runtime } from "./runtime.js";
import {
  deleteTokenStore,
  isTokenExpired,
  readTokenStore,
  type SpotifyTokenSet,
  withFileLock,
  writeTokenStore,
} from "./token-store.js";

const API_BASE_URL = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const MAX_ATTEMPTS = 3;
// Longer waits go back to the caller, who can decide to do other work first.
const MAX_RETRY_WAIT_SECONDS = 10;

export const REQUIRED_SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-top-read",
  "user-follow-read",
  "user-follow-modify",
  "user-library-read",
  "user-library-modify",
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-private",
];

export type RequestOptions = {
  method?: string;
  body?: Record<string, any> | undefined;
  searchParams?: Record<string, string | number | boolean | undefined>;
};

export async function clearStoredTokens(): Promise<void> {
  await deleteTokenStore(TOKEN_PATH);
}

export async function getStoredTokens(): Promise<SpotifyTokenSet | null> {
  return readTokenStore(TOKEN_PATH);
}

async function safeFetch(url: URL | string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SpotError("NETWORK", `Could not reach Spotify: ${reason}`, {
      hint: "Check the internet connection, then try again.",
    });
  }
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, any>> {
  const response = await safeFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  const text = await response.text();
  const json = parseJson(text) as Record<string, any> | undefined;

  if (!response.ok) {
    const message = String(
      json?.error_description ?? json?.error ?? (text.trim() || "Spotify refused the login."),
    );
    const loginIsDead = response.status === 400 || response.status === 401;
    throw new SpotError(loginIsDead ? "AUTH_EXPIRED" : "SPOTIFY_ERROR", message, {
      status: response.status,
      hint: loginIsDead ? LOGIN_HINT : "Spotify had a problem. Try again.",
    });
  }

  if (typeof json?.access_token !== "string") {
    throw new SpotError("SPOTIFY_ERROR", "Spotify sent a login reply with no access token.");
  }

  return json;
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<SpotifyTokenSet> {
  const { clientId, redirectUri } = await getResolvedConfig();
  const json = await tokenRequest({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

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
  const json = await tokenRequest({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

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

async function refreshWithLock(staleTokens: SpotifyTokenSet): Promise<SpotifyTokenSet> {
  return withFileLock(TOKEN_LOCK_PATH, async () => {
    // A different process can have done the refresh while this one waited for the lock.
    const current = await readTokenStore(TOKEN_PATH);
    if (
      current
      && current.accessToken !== staleTokens.accessToken
      && !isTokenExpired(current.expiresAt)
    ) {
      return current;
    }

    return refreshAccessToken(current ?? staleTokens);
  });
}

async function getValidTokens(): Promise<SpotifyTokenSet> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    throw new SpotError("NOT_LOGGED_IN", "No Spotify login found.", { hint: LOGIN_HINT });
  }

  return isTokenExpired(tokens.expiresAt) ? refreshWithLock(tokens) : tokens;
}

export async function spotifyRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let tokens = await getValidTokens();
  const method = options.method ?? "GET";
  const url = new URL(`${API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  let refreshedAfter401 = false;

  for (let attempt = 1; ; attempt += 1) {
    const response = await safeFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();

    if (response.ok) {
      // Player commands reply with an empty body, and some with plain text. Both mean success.
      return parseJson(text) as T;
    }

    if (response.status === 401 && !refreshedAfter401) {
      refreshedAfter401 = true;
      tokens = await refreshWithLock(tokens);
      continue;
    }

    const error = spotifyHttpError(response.status, text, response.headers.get("retry-after"));

    if (attempt < MAX_ATTEMPTS) {
      if (error.code === "RATE_LIMITED") {
        const waitSeconds = error.retryAfterSeconds ?? 1;
        if (waitSeconds <= MAX_RETRY_WAIT_SECONDS) {
          await runtime.sleep(waitSeconds * 1000);
          continue;
        }
      }

      // A read is safe to send again. A write is not: the first try can have worked.
      if (response.status >= 500 && method === "GET") {
        await runtime.sleep(500);
        continue;
      }
    }

    throw error;
  }
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
