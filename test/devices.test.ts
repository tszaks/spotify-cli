import { writeFile } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { ensureDevice } from "../src/devices.js";
import { CONFIG_PATH } from "../src/paths.js";
import { resolveDevice } from "../src/playback-utils.js";
import { runtime } from "../src/runtime.js";
import { login } from "./helpers/cli.js";
import { device, FakeSpotify } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  runtime.launchSpotify = async () => false;
  await login();
});

describe("resolveDevice", () => {
  const devices = [device("d1", "Tyler's MacBook Pro"), device("d2", "iPhone"), device("d3", "MacBook Air")];

  it("finds a device by a part of its name when only one matches", () => {
    expect(resolveDevice(devices, "iphone")?.id).toBe("d2");
    expect(resolveDevice(devices, "pro")?.id).toBe("d1");
  });

  it("does not guess when a part of a name matches two devices", () => {
    expect(resolveDevice(devices, "macbook")).toBeUndefined();
  });
});

describe("ensureDevice", () => {
  it("uses the active device and sends no device id", async () => {
    spotify.devices = [device("d1", "Mac"), device("d2", "iPhone", true)];

    const choice = await ensureDevice();

    expect(choice.deviceId).toBeUndefined();
    expect(choice.device?.name).toBe("iPhone");
  });

  it("uses the only device when it is idle", async () => {
    spotify.devices = [device("d1", "Mac")];

    expect((await ensureDevice()).deviceId).toBe("d1");
  });

  it("does not guess between two idle devices, and lists them", async () => {
    spotify.devices = [device("d1", "Mac"), device("d2", "Patio Amp", false, "AVR")];

    await expect(ensureDevice()).rejects.toMatchObject({
      code: "NO_ACTIVE_DEVICE",
      hint: "Run the command again with --device <name>.",
      extra: { devices: [expect.objectContaining({ name: "Mac" }), expect.objectContaining({ name: "Patio Amp" })] },
    });
  });

  it("uses the default device from the config when no device is active", async () => {
    spotify.devices = [device("d1", "Mac"), device("d2", "Patio Amp")];
    await writeFile(CONFIG_PATH, JSON.stringify({ clientId: "test-client", defaultDevice: "mac" }));

    expect((await ensureDevice()).deviceId).toBe("d1");
  });

  it("uses the named device, and reports a name that matches nothing", async () => {
    spotify.devices = [device("d1", "Mac", true), device("d2", "iPhone")];

    expect((await ensureDevice({ selector: "iphone" })).deviceId).toBe("d2");
    await expect(ensureDevice({ selector: "kitchen" })).rejects.toMatchObject({
      code: "DEVICE_NOT_FOUND",
      extra: { devices: expect.arrayContaining([expect.objectContaining({ name: "Mac" })]) },
    });
  });

  it("tells the caller about --wake when no device is open, and does not start the app by itself", async () => {
    let launches = 0;
    runtime.launchSpotify = async () => {
      launches += 1;
      return true;
    };

    await expect(ensureDevice()).rejects.toMatchObject({
      code: "NO_ACTIVE_DEVICE",
      hint: expect.stringContaining("--wake"),
    });
    expect(launches).toBe(0);
  });

  it("starts Spotify with --wake and uses the device that appears", async () => {
    runtime.launchSpotify = async () => {
      spotify.devices = [device("d1", "Mac")];
      return true;
    };

    const choice = await ensureDevice({ wake: true });

    expect(choice).toMatchObject({ deviceId: "d1", woke: true });
  });

  it("reports when --wake cannot start Spotify", async () => {
    await expect(ensureDevice({ wake: true })).rejects.toMatchObject({
      code: "NO_ACTIVE_DEVICE",
      message: "No Spotify device is available.",
    });
  });
});
