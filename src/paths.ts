import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "spotify-cli";
// SPOT_CONFIG_DIR points the CLI at a different folder, so tests never touch the real login.
export const APP_DIR = process.env.SPOT_CONFIG_DIR ?? join(homedir(), ".config", APP_NAME);
export const CONFIG_PATH = join(APP_DIR, "config.json");
export const TOKEN_PATH = join(APP_DIR, "tokens.json");
export const TOKEN_LOCK_PATH = join(APP_DIR, "tokens.lock");
export const AUTH_SESSION_PATH = join(APP_DIR, "auth-session.json");
export const DJ_SESSION_PATH = join(APP_DIR, "dj-session.json");
export const DEFAULT_REDIRECT_URI = "https://szakacsmedia.com/spotify-cli/callback";
