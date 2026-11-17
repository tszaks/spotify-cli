import { SpotError } from "./errors.js";

export function parseAuthorizationCallbackUrl(
  callbackUrl: string,
  expectedState: string,
): string {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new SpotError("BAD_INPUT", "That is not a full URL. Copy the full address from the browser.");
  }

  const error = url.searchParams.get("error");

  if (error) {
    throw new SpotError("BAD_INPUT", `Spotify authorization failed: ${error}`);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new SpotError("BAD_INPUT", "Spotify did not return an authorization code.");
  }

  const state = url.searchParams.get("state");
  if (state !== expectedState) {
    throw new SpotError("BAD_INPUT", "Spotify returned an unexpected state value.");
  }

  return code;
}
