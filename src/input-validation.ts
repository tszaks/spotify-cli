export function parseOnOffState(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "on") {
    return true;
  }

  if (normalized === "off") {
    return false;
  }

  throw new Error("Expected 'on' or 'off'.");
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
    throw new Error(`${label} must be a number.`);
  }

  const integer = Math.floor(value);

  if (options?.min !== undefined && integer < options.min) {
    throw new Error(`${label} must be at least ${options.min}.`);
  }

  if (options?.max !== undefined && integer > options.max) {
    throw new Error(`${label} must be at most ${options.max}.`);
  }

  return integer;
}
