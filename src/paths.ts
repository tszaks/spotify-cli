import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "spotify-cli";
export const APP_DIR = join(homedir(), ".config", APP_NAME);
export const CONFIG_PATH = join(APP_DIR, "config.json");
export const TOKEN_PATH = join(APP_DIR, "tokens.json");
export const AUTH_SESSION_PATH = join(APP_DIR, "auth-session.json");
export const DEFAULT_REDIRECT_URI = "https://szakacsmedia.com/spotify-cli/callback";
