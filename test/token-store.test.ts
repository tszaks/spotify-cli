import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isTokenExpired,
  readTokenStore,
  withFileLock,
  writeTokenStore,
} from "../src/token-store.js";

const tokens = {
  accessToken: "a",
  refreshToken: "r",
  scope: "s",
  tokenType: "Bearer",
  expiresAt: 1,
};

describe("isTokenExpired", () => {
  it("returns true for expired tokens", () => {
    expect(isTokenExpired(Date.now() - 1)).toBe(true);
  });

  it("returns false for future tokens", () => {
    expect(isTokenExpired(Date.now() + 60_000)).toBe(false);
  });
});

describe("token file", () => {
  it("is private to the owner and leaves no temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spot-store-"));
    const path = join(dir, "tokens.json");

    await writeTokenStore(path, tokens);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(["tokens.json"]);
    expect(await readTokenStore(path)).toEqual(tokens);
  });

  it("makes an old file that all users could read private on the next write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spot-store-"));
    const path = join(dir, "tokens.json");
    await writeFile(path, "{}", { mode: 0o644 });

    await writeTokenStore(path, tokens);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("gives null when there is no file", async () => {
    expect(await readTokenStore(join(tmpdir(), "spot-no-such-file.json"))).toBeNull();
  });

  it("reports a damaged file as a login problem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spot-store-"));
    const path = join(dir, "tokens.json");
    await writeFile(path, "{ not json");

    await expect(readTokenStore(path)).rejects.toMatchObject({ code: "NOT_LOGGED_IN" });
  });
});

describe("withFileLock", () => {
  it("runs one action at a time", async () => {
    const lock = join(await mkdtemp(join(tmpdir(), "spot-lock-")), "tokens.lock");
    const order: string[] = [];

    const job = (name: string) =>
      withFileLock(lock, async () => {
        order.push(`${name} start`);
        await new Promise((resolve) => {
          setTimeout(resolve, 30);
        });
        order.push(`${name} end`);
      });

    await Promise.all([job("a"), job("b")]);

    // Either job can win the lock. The rule is that they never overlap.
    expect([
      ["a start", "a end", "b start", "b end"],
      ["b start", "b end", "a start", "a end"],
    ]).toContainEqual(order);
  });

  it("removes the lock when the action fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spot-lock-"));
    const lock = join(dir, "tokens.lock");

    await expect(withFileLock(lock, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(await readdir(dir)).toEqual([]);
  });

  it("takes a lock that a crashed process left behind", async () => {
    const lock = join(await mkdtemp(join(tmpdir(), "spot-lock-")), "tokens.lock");
    await writeFile(lock, "");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);

    await expect(withFileLock(lock, async () => "done")).resolves.toBe("done");
  });

  it("returns the value of the action", async () => {
    const lock = join(await mkdtemp(join(tmpdir(), "spot-lock-")), "tokens.lock");
    await writeFile(join(lock, "..", "note.txt"), "x");

    expect(await withFileLock(lock, async () => 42)).toBe(42);
    expect(await readFile(join(lock, "..", "note.txt"), "utf8")).toBe("x");
  });
});
