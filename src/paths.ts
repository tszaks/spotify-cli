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
// Taste memory. Plain files, so the user can read them and an agent can learn from them.
export const LISTENING_PATH = join(APP_DIR, "listening.jsonl");
export const FEELINGS_PATH = join(APP_DIR, "feelings.jsonl");
export const TASTE_NOTES_PATH = join(APP_DIR, "taste-notes.md");
export const WATCH_STATE_PATH = join(APP_DIR, "watch-state.json");
export const WATCH_LOCK_PATH = join(APP_DIR, "watch.lock");
export const WATCH_LOG_PATH = join(APP_DIR, "watch.log");
export const DEFAULT_REDIRECT_URI = "https://szakacsmedia.com/spotify-cli/callback";
