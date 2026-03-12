import { describe, expect, it } from "vitest";

import {
  parseBoundedInteger,
  parseOnOffState,
} from "../src/input-validation.js";

describe("parseOnOffState", () => {
  it("accepts on and off values", () => {
    expect(parseOnOffState("on")).toBe(true);
    expect(parseOnOffState("off")).toBe(false);
  });

  it("rejects invalid toggle values", () => {
    expect(() => parseOnOffState("maybe")).toThrow(
      "Expected 'on' or 'off'.",
    );
  });
});

describe("parseBoundedInteger", () => {
  it("accepts a valid bounded integer", () => {
    expect(parseBoundedInteger(42, "volume", { min: 0, max: 100 })).toBe(42);
  });

  it("rejects non-numeric values", () => {
    expect(() =>
      parseBoundedInteger(Number.NaN, "seek position"),
    ).toThrow("seek position must be a number.");
  });

  it("rejects out-of-range values", () => {
    expect(() =>
      parseBoundedInteger(101, "volume", { min: 0, max: 100 }),
    ).toThrow("volume must be at most 100.");
  });
});
