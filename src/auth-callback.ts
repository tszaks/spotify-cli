export function parseAuthorizationCallbackUrl(
  callbackUrl: string,
  expectedState: string,
): string {
  const url = new URL(callbackUrl);
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`Spotify authorization failed: ${error}`);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("Spotify did not return an authorization code.");
  }

  const state = url.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("Spotify returned an unexpected state value.");
  }

  return code;
}
