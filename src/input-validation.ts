import { SpotError } from "./errors.js";

export function parseOnOffState(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "on") {
    return true;
  }

  if (normalized === "off") {
    return false;
  }

  throw new SpotError("BAD_INPUT", "Expected 'on' or 'off'.");
}

export function parseBoundedInteger(
  value: number,
  label: string,
  options?: {
    min?: number;
    max?: number;
  },
): number {
  if (!Number.isFinite(value)) {
    throw new SpotError("BAD_INPUT", `${label} must be a number.`);
  }

  const integer = Math.floor(value);

  if (options?.min !== undefined && integer < options.min) {
    throw new SpotError("BAD_INPUT", `${label} must be at least ${options.min}.`);
  }

  if (options?.max !== undefined && integer > options.max) {
    throw new SpotError("BAD_INPUT", `${label} must be at most ${options.max}.`);
  }

  return integer;
}
