export type ErrorCode =
  | "BAD_INPUT"
  | "NOT_LOGGED_IN"
  | "AUTH_EXPIRED"
  | "SCOPE_MISSING"
  | "PREMIUM_REQUIRED"
  | "FORBIDDEN"
  | "NO_ACTIVE_DEVICE"
  | "DEVICE_NOT_FOUND"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "NETWORK"
  | "SPOTIFY_ERROR"
  | "INTERNAL";

const EXIT_CODES: Record<ErrorCode, number> = {
  INTERNAL: 1,
  BAD_INPUT: 2,
  NOT_LOGGED_IN: 3,
  AUTH_EXPIRED: 3,
  SCOPE_MISSING: 3,
  NO_ACTIVE_DEVICE: 4,
  DEVICE_NOT_FOUND: 4,
  NOT_FOUND: 5,
  RATE_LIMITED: 6,
  QUOTA_EXCEEDED: 6,
  PREMIUM_REQUIRED: 7,
  FORBIDDEN: 7,
  NETWORK: 8,
  SPOTIFY_ERROR: 8,
};

// The browser login needs a person, so the hint names who can do the fix.
export const LOGIN_HINT = "A person must run `spot auth login` and then `spot auth finish`.";
export const NO_DEVICE_HINT =
  "Open Spotify on a phone, computer or speaker. Or add --wake to open Spotify on this computer.";

export type ErrorPayload = {
  code: ErrorCode;
  message: string;
  hint?: string;
  status?: number;
  retryAfterSeconds?: number;
} & Record<string, unknown>;

export class SpotError extends Error {
  readonly code: ErrorCode;

  readonly hint?: string;

  readonly status?: number;

  readonly retryAfterSeconds?: number;

  // Data the caller can act on, for example the list of available devices.
  readonly extra?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      hint?: string;
      status?: number;
      retryAfterSeconds?: number;
      extra?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "SpotError";
    this.code = code;
    this.hint = options.hint;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.extra = options.extra;
  }
}

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_CODES[code] ?? 1;
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof SpotError) {
    return {
      code: error.code,
      message: error.message,
      hint: error.hint,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
      ...error.extra,
    };
  }

  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function parseJson(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Spotify sends plain text for some replies. The caller decides what that means.
    return undefined;
  }
}

export function spotifyHttpError(
  status: number,
  bodyText: string,
  retryAfterHeader: string | null,
): SpotError {
  const json = parseJson(bodyText) as Record<string, any> | undefined;
  const nested = json && typeof json.error === "object" && json.error !== null
    ? (json.error as Record<string, any>)
    : undefined;
  const message = String(
    nested?.message
      ?? (typeof json?.error === "string" ? json.error : undefined)
      ?? json?.message
      ?? (bodyText.trim() || `Spotify replied with HTTP ${status}.`),
  );
  const reason = String(nested?.reason ?? json?.reason ?? "");

  if (status === 400) {
    return new SpotError("BAD_INPUT", message, { status });
  }

  if (status === 401) {
    return new SpotError("AUTH_EXPIRED", message, { status, hint: LOGIN_HINT });
  }

  if (status === 403) {
    if (reason === "PREMIUM_REQUIRED" || /premium/i.test(message)) {
      return new SpotError("PREMIUM_REQUIRED", message, {
        status,
        hint: "The owner of the Spotify developer app needs an active Premium plan. After a plan change, wait some hours and try again.",
      });
    }

    if (/scope/i.test(message)) {
      return new SpotError("SCOPE_MISSING", message, {
        status,
        hint: `The login does not have a necessary permission. ${LOGIN_HINT}`,
      });
    }

    return new SpotError("FORBIDDEN", message, {
      status,
      hint: /restriction/i.test(message)
        ? "Spotify refused this action in the current state. Example: pause when the music is already paused."
        : undefined,
    });
  }

  if (status === 404) {
    if (reason === "NO_ACTIVE_DEVICE" || /no active device/i.test(message)) {
      return new SpotError("NO_ACTIVE_DEVICE", message, { status, hint: NO_DEVICE_HINT });
    }

    if (/device not found/i.test(message)) {
      return new SpotError("DEVICE_NOT_FOUND", message, {
        status,
        hint: "Run `spot devices list` to see the devices.",
      });
    }

    return new SpotError("NOT_FOUND", message, { status });
  }

  if (status === 429) {
    const seconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const retryAfterSeconds = Number.isFinite(seconds) ? seconds : undefined;

    if (reason === "QUOTA_EXCEEDED") {
      return new SpotError("QUOTA_EXCEEDED", message, {
        status,
        retryAfterSeconds,
        hint: "The Spotify developer account used its quota. Wait before you send more requests.",
      });
    }

    return new SpotError("RATE_LIMITED", message, {
      status,
      retryAfterSeconds,
      hint: "Wait, then try again.",
    });
  }

  return new SpotError("SPOTIFY_ERROR", message, {
    status,
    hint: status >= 500 ? "Spotify had a problem. Try again." : undefined,
  });
}
