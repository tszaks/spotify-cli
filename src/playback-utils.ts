export type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  supports_volume: boolean;
  type: string;
  volume_percent: number | null;
};

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 10;

export function normalizeSearchLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(limit)));
}

export function resolveDevice(
  devices: SpotifyDevice[],
  selector?: string,
): SpotifyDevice | undefined {
  if (devices.length === 0) {
    return undefined;
  }

  if (!selector) {
    return devices.find((device) => device.is_active) ?? devices[0];
  }

  const exactIdMatch = devices.find((device) => device.id === selector);
  if (exactIdMatch) {
    return exactIdMatch;
  }

  const normalizedSelector = selector.trim().toLowerCase();

  return devices.find(
    (device) => device.name.trim().toLowerCase() === normalizedSelector,
  );
}
