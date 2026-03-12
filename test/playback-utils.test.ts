import { describe, expect, it } from "vitest";

import { normalizeSearchLimit, resolveDevice } from "../src/playback-utils.js";

describe("search limits", () => {
  it("caps the limit at spotify's current dev-mode max of 10", () => {
    expect(normalizeSearchLimit(undefined)).toBe(5);
    expect(normalizeSearchLimit(1)).toBe(1);
    expect(normalizeSearchLimit(99)).toBe(10);
  });
});

describe("device resolution", () => {
  const devices = [
    {
      id: "dev-1",
      is_active: false,
      is_private_session: false,
      is_restricted: false,
      name: "Living Room",
      supports_volume: true,
      type: "speaker",
      volume_percent: 40,
    },
    {
      id: "dev-2",
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: "MacBook Pro",
      supports_volume: true,
      type: "computer",
      volume_percent: 70,
    },
  ];

  it("matches an exact device id first", () => {
    expect(resolveDevice(devices, "dev-1")?.name).toBe("Living Room");
  });

  it("matches a device by case-insensitive name", () => {
    expect(resolveDevice(devices, "macbook pro")?.id).toBe("dev-2");
  });

  it("falls back to the active device when no selector is supplied", () => {
    expect(resolveDevice(devices)?.id).toBe("dev-2");
  });
});
