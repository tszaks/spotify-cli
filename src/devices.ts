import { readConfig } from "./config-store.js";
import { NO_DEVICE_HINT, SpotError } from "./errors.js";
import { resolveDevice, type SpotifyDevice } from "./playback-utils.js";
import { runtime } from "./runtime.js";
import { type Device, toDevice } from "./shapes.js";
import { spotifyRequest } from "./spotify-client.js";

const WAKE_POLLS = 15;

export type DeviceChoice = {
  // Undefined means "the active device", which Spotify selects by itself.
  deviceId?: string;
  device?: Device;
  woke: boolean;
};

export async function getDevices(): Promise<SpotifyDevice[]> {
  const data = await spotifyRequest<{ devices: SpotifyDevice[] } | undefined>("/me/player/devices");
  return data?.devices ?? [];
}

export async function getResolvedDeviceId(selector?: string): Promise<string | undefined> {
  if (!selector) {
    return undefined;
  }

  const devices = await getDevices();
  const device = resolveDevice(devices, selector);

  if (!device?.id) {
    throw new SpotError("DEVICE_NOT_FOUND", `No Spotify device matches "${selector}".`, {
      hint: "Use the name or id of one of the listed devices.",
      extra: { devices: devices.map(toDevice) },
    });
  }

  return device.id;
}

async function wakeAndWait(): Promise<SpotifyDevice[]> {
  if (!(await runtime.launchSpotify())) {
    return [];
  }

  // The desktop app needs some seconds before Spotify lists it as a device.
  for (let poll = 0; poll < WAKE_POLLS; poll += 1) {
    await runtime.sleep(1000);
    const devices = await getDevices();
    if (devices.length > 0) {
      return devices;
    }
  }

  return [];
}

// Finds where the music must play. It never guesses between two speakers,
// and it starts Spotify on this computer only when the caller asks with `wake`.
export async function ensureDevice(
  options: { selector?: string; wake?: boolean } = {},
): Promise<DeviceChoice> {
  let devices = await getDevices();
  let woke = false;

  if (devices.length === 0 && options.wake) {
    devices = await wakeAndWait();
    woke = devices.length > 0;
  }

  const listed = devices.map(toDevice);

  if (options.selector) {
    const match = resolveDevice(devices, options.selector);
    if (!match?.id) {
      throw new SpotError("DEVICE_NOT_FOUND", `No Spotify device matches "${options.selector}".`, {
        hint: devices.length > 0 ? "Use the name or id of one of the listed devices." : NO_DEVICE_HINT,
        extra: { devices: listed },
      });
    }

    return { deviceId: match.id, device: toDevice(match), woke };
  }

  const active = devices.find((device) => device.is_active);
  if (active) {
    return { device: toDevice(active), woke };
  }

  const { defaultDevice } = await readConfig();
  const preferred = defaultDevice ? resolveDevice(devices, defaultDevice) : undefined;
  if (preferred?.id) {
    return { deviceId: preferred.id, device: toDevice(preferred), woke };
  }

  const usable = devices.filter((device) => device.id && !device.is_restricted);
  if (usable.length === 1) {
    return { deviceId: usable[0].id ?? undefined, device: toDevice(usable[0]), woke };
  }

  if (usable.length > 1) {
    throw new SpotError(
      "NO_ACTIVE_DEVICE",
      "No device is active, and more than one device is available.",
      {
        hint: "Run the command again with --device <name>.",
        extra: { devices: listed },
      },
    );
  }

  throw new SpotError("NO_ACTIVE_DEVICE", "No Spotify device is available.", {
    hint: options.wake
      ? "Spotify did not start on this computer. Open Spotify on a device, then try again."
      : NO_DEVICE_HINT,
    extra: { devices: listed },
  });
}
