import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

// Each test file gets its own folder, so no test can read or change the real Spotify login.
process.env.SPOT_CONFIG_DIR = mkdtempSync(join(tmpdir(), "spot-test-"));
process.env.SPOT_LAUNCH_AGENTS_DIR = mkdtempSync(join(tmpdir(), "spot-launch-"));
delete process.env.SPOTIFY_CLIENT_ID;
delete process.env.SPOTIFY_REDIRECT_URI;
delete process.env.SPOT_OUTPUT;

// Tests must not call the real Spotify API. A test that needs replies installs FakeSpotify.
vi.stubGlobal("fetch", async (input: unknown) => {
  throw new Error(`Test tried to use the network: ${String(input)}`);
});
