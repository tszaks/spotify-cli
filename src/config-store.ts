import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CONFIG_PATH, DEFAULT_REDIRECT_URI } from "./paths.js";

export type AppConfig = {
  clientId?: string;
  redirectUri?: string;
};

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as AppConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return {};
    }

    throw error;
  }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function setClientId(clientId: string): Promise<void> {
  const current = await readConfig();
  await writeConfig({
    ...current,
    clientId,
  });
}

export async function setRedirectUri(redirectUri: string): Promise<void> {
  const current = await readConfig();
  await writeConfig({
    ...current,
    redirectUri,
  });
}

export async function getResolvedConfig(): Promise<Required<AppConfig>> {
  const config = await readConfig();
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? config.clientId;

  if (!clientId) {
    throw new Error(
      "No Spotify client ID found. Run `spot config set-client-id <client-id>` or set SPOTIFY_CLIENT_ID.",
    );
  }

  return {
    clientId,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? config.redirectUri ?? DEFAULT_REDIRECT_URI,
  };
}
