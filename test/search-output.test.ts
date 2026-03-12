import { describe, expect, it } from "vitest";

import { formatSearchItemSummary } from "../src/output.js";

describe("formatSearchItemSummary", () => {
  it("formats track-like search results with artists", () => {
    expect(
      formatSearchItemSummary({
        artists: [{ name: "NF" }],
        name: "FEAR",
      }),
    ).toBe("FEAR - NF");
  });

  it("formats playlist-like search results with owners", () => {
    expect(
      formatSearchItemSummary({
        name: "Rock Mix",
        owner: { display_name: "Tyler" },
      }),
    ).toBe("Rock Mix - Tyler");
  });

  it("handles null items safely", () => {
    expect(formatSearchItemSummary(null)).toBe("Unknown item");
  });
});
