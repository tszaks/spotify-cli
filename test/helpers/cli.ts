import { mkdir, writeFile } from "node:fs/promises";

import { main } from "../../src/cli.js";
import { APP_DIR, CONFIG_PATH, DJ_SESSION_PATH, TOKEN_PATH } from "../../src/paths.js";
import { runtime } from "../../src/runtime.js";

// No real waits in tests.
runtime.sleep = async () => undefined;
runtime.launchSpotify = async () => false;

export async function login(tokens: Record<string, unknown> = {}): Promise<void> {
  await mkdir(APP_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ clientId: "test-client" }));
  await writeFile(
    TOKEN_PATH,
    JSON.stringify({
      accessToken: "access-0",
      refreshToken: "refresh-0",
      scope: "test",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3_600_000,
      ...tokens,
    }),
  );
}

export async function logout(): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(TOKEN_PATH, { force: true });
  await rm(DJ_SESSION_PATH, { force: true });
}

export type CliResult = {
  code: number;
  out: string;
  err: string;
  // The parsed reply in JSON mode. Undefined when the output is text.
  json: any;
};

// Runs the full command tree in this process, as an agent would: no terminal, so JSON output.
export async function spot(
  args: string[],
  options: { tty?: boolean; stdin?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];

  const code = await main(["node", "spot", ...args], {
    out: (text) => {
      out.push(text);
    },
    err: (text) => {
      err.push(text);
    },
    isTTY: Boolean(options.tty),
    env: options.env ?? {},
    readStdin: async () => options.stdin ?? "",
  });

  const text = out.join("\n");
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  return { code, out: text, err: err.join("\n"), json };
}
