import { beforeEach, describe, expect, it } from "vitest";

import { parseNameLines } from "../src/resolve.js";
import { login, spot } from "./helpers/cli.js";
import { FakeSpotify, track } from "./helpers/fake-spotify.js";

let spotify: FakeSpotify;

beforeEach(async () => {
  spotify = new FakeSpotify().install();
  spotify.catalog = [
    track("fear", "FEAR", "NF"),
    track("world", "Around the World", "Daft Punk"),
    track("robot", "Robot Rock", "Daft Punk"),
    track("pressure", "Under Pressure - Remastered 2011", "Queen, David Bowie"),
  ];
  await login();
});

describe("parseNameLines", () => {
  it("reads one song for each line and drops list marks, empty lines and comments", () => {
    const text = "1. NF - Fear\n2) Daft Punk - Around the World\n- Queen - Under Pressure\n\n# a comment\n  spotify:track:abc  ";

    expect(parseNameLines(text)).toEqual([
      "NF - Fear",
      "Daft Punk - Around the World",
      "Queen - Under Pressure",
      "spotify:track:abc",
    ]);
  });

  it("keeps a title that starts with a year", () => {
    expect(parseNameLines("1979 - The Smashing Pumpkins")).toEqual(["1979 - The Smashing Pumpkins"]);
  });
});

describe("spot resolve", () => {
  it("changes a list of names into URIs in one command", async () => {
    const result = await spot(["resolve", "--from", "-"], {
      stdin: "NF - Fear\nDaft Punk - Around the World\nQueen - Under Pressure",
    });

    expect(result.json.resolved.map((item: any) => [item.input, item.uri, item.confidence])).toEqual([
      ["NF - Fear", "spotify:track:fear", "high"],
      ["Daft Punk - Around the World", "spotify:track:world", "high"],
      ["Queen - Under Pressure", "spotify:track:pressure", "high"],
    ]);
    expect(result.json.missed).toEqual([]);
  });

  it("reports an invented song as missed and names the closest real song", async () => {
    const result = await spot(["resolve", "Daft Punk - Midnight Robots From Mars", "NF - Fear"]);

    expect(result.code).toBe(0);
    expect(result.json.resolved.map((item: any) => item.uri)).toEqual(["spotify:track:fear"]);
    expect(result.json.missed).toEqual([
      {
        input: "Daft Punk - Midnight Robots From Mars",
        reason: expect.stringContaining("possibly not real"),
        closest: { label: "Around the World - Daft Punk", uri: "spotify:track:world" },
      },
    ]);
  });

  it("accepts a weak match with --loose", async () => {
    const result = await spot(["resolve", "Daft Punk - Midnight Robots From Mars", "--loose"]);

    expect(result.json.resolved[0]).toMatchObject({ uri: "spotify:track:world", confidence: "low" });
  });

  it("passes URIs and links through with no search", async () => {
    const result = await spot(["resolve", "spotify:track:abc", "https://open.spotify.com/track/def"]);

    expect(result.json.resolved).toEqual([
      { input: "spotify:track:abc", uri: "spotify:track:abc", confidence: "exact" },
      { input: "https://open.spotify.com/track/def", uri: "spotify:track:def", confidence: "exact" },
    ]);
    expect(spotify.calls).toHaveLength(0);
  });

  it("removes a song that is in the list two times", async () => {
    const result = await spot(["resolve", "NF - Fear", "fear nf"]);

    expect(result.json.resolved).toHaveLength(1);
    expect(result.json.duplicatesRemoved).toBe(1);
  });

  it("tries plain words when the first search finds nothing", async () => {
    // Copies a search that finds nothing for the text with the note in brackets.
    spotify.intercept = (call) =>
      call.query.q?.includes("(")
        ? new Response(JSON.stringify({ tracks: { items: [] } }), { status: 200 })
        : undefined;

    const result = await spot(["resolve", "Queen - Under Pressure (Zzyzx Version)"]);

    expect(result.json.resolved[0]).toMatchObject({ uri: "spotify:track:pressure" });
    expect(spotify.callsTo("GET", "/search").map((call) => call.query.q)).toEqual([
      "Queen - Under Pressure (Zzyzx Version)",
      "Queen Under Pressure",
    ]);
  });

  it("stops with the real cause when Spotify refuses the searches", async () => {
    spotify.intercept = () => new Response("", { status: 429, headers: { "retry-after": "600" } });

    const result = await spot(["resolve", "NF - Fear", "Daft Punk - Around the World"]);

    expect(result.code).toBe(6);
    expect(result.json.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 600 });
  });

  it("asks for songs when the list is empty", async () => {
    const result = await spot(["resolve", "--from", "-"], { stdin: "\n# nothing\n" });

    expect(result.json.error.code).toBe("BAD_INPUT");
  });

  it("reports a file that it cannot read", async () => {
    const result = await spot(["resolve", "--from", "/no/such/file.txt"]);

    expect(result.json.error).toMatchObject({ code: "BAD_INPUT", message: "Cannot read the file /no/such/file.txt." });
  });
});
