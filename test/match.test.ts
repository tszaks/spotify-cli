import { describe, expect, it } from "vitest";

import { baseTitle, matchTrack, normalize, pickBestMatch } from "../src/match.js";

describe("normalize", () => {
  it("removes case, accents and punctuation", () => {
    expect(normalize("Beyoncé — Déjà Vu!")).toBe("beyonce deja vu");
    expect(normalize("Guns N' Roses & Friends")).toBe("guns n roses and friends");
  });

  it("keeps letters of other alphabets", () => {
    expect(normalize("夜に駆ける")).toBe("夜に駆ける");
  });
});

describe("baseTitle", () => {
  it("removes version notes", () => {
    expect(baseTitle("Under Pressure - Remastered 2011")).toBe("Under Pressure");
    expect(baseTitle("Stay (feat. Justin Bieber)")).toBe("Stay");
  });

  it("keeps a title that is only a note", () => {
    expect(baseTitle("(Intro)")).toBe("(Intro)");
  });
});

describe("matchTrack", () => {
  it("is high when title and artist are in the input, in any order", () => {
    const fear = { name: "FEAR", artists: ["NF"] };

    expect(matchTrack("NF - Fear", fear).confidence).toBe("high");
    expect(matchTrack("fear nf", fear).confidence).toBe("high");
  });

  it("accepts a remaster as the same song", () => {
    const song = { name: "Under Pressure - Remastered 2011", artists: ["Queen", "David Bowie"] };

    expect(matchTrack("Queen - Under Pressure", song).confidence).toBe("high");
  });

  it("is medium for a live copy that the input did not ask for", () => {
    const live = { name: "Bohemian Rhapsody - Live at Wembley", artists: ["Queen"] };

    expect(matchTrack("Queen - Bohemian Rhapsody", live).confidence).toBe("medium");
    expect(matchTrack("Queen - Bohemian Rhapsody live", live).confidence).toBe("high");
  });

  it("is medium when the input has only a title", () => {
    expect(matchTrack("Bohemian Rhapsody", { name: "Bohemian Rhapsody", artists: ["Queen"] }).confidence)
      .toBe("medium");
  });

  it("is low for a song by a different artist with a different title", () => {
    const other = { name: "Midnight City", artists: ["M83"] };

    expect(matchTrack("Daft Punk - Midnight Robots From Mars", other).confidence).toBe("low");
  });

  it("is low for the right title by the wrong artist", () => {
    const cover = { name: "Hallelujah", artists: ["Karaoke Stars"] };

    expect(matchTrack("Jeff Buckley - Hallelujah", cover).confidence).toBe("low");
  });
});

describe("pickBestMatch", () => {
  it("selects the studio copy over the live copy", () => {
    const candidates = [
      { name: "Bohemian Rhapsody - Live at Wembley", artists: ["Queen"], id: "live" },
      { name: "Bohemian Rhapsody - Remastered 2011", artists: ["Queen"], id: "studio" },
    ];

    expect(pickBestMatch("Queen - Bohemian Rhapsody", candidates)?.item.id).toBe("studio");
  });

  it("keeps Spotify's order on a tie", () => {
    const candidates = [
      { name: "Fear", artists: ["NF"], id: "first" },
      { name: "Fear", artists: ["NF"], id: "second" },
    ];

    expect(pickBestMatch("NF - Fear", candidates)?.item.id).toBe("first");
  });

  it("gives undefined for no candidates", () => {
    expect(pickBestMatch("NF - Fear", [])).toBeUndefined();
  });
});
