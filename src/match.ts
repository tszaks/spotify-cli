// Decides if a Spotify search result is the song that a line of text asked for.
// An agent sometimes names a song that does not exist. A weak match must not pass as a real one.

export type Confidence = "high" | "medium" | "low";

export type MatchResult = {
  score: number;
  confidence: Confidence;
};

// Words that mark a different recording of the same song.
const VARIANT_WORDS = [
  "live",
  "karaoke",
  "instrumental",
  "remix",
  "cover",
  "tribute",
  "acoustic",
  "demo",
  "sped up",
  "slowed",
  "nightcore",
  "lullaby",
  "commentary",
  "made famous",
  "originally performed",
];

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// "Song (feat. X) - Remastered 2011" becomes "Song".
export function baseTitle(title: string): string {
  const stripped = title
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .trim();

  return stripped || title;
}

function hasPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

function tokenOverlap(wanted: string, text: string): number {
  const wantedTokens = wanted.split(" ").filter(Boolean);
  if (wantedTokens.length === 0) {
    return 0;
  }

  const textTokens = new Set(text.split(" "));
  return wantedTokens.filter((token) => textTokens.has(token)).length / wantedTokens.length;
}

export function matchTrack(
  input: string,
  candidate: { name: string; artists: string[] },
): MatchResult {
  const wanted = normalize(input);
  const fullTitle = normalize(candidate.name);
  const shortTitle = normalize(baseTitle(candidate.name));

  const titleHit = hasPhrase(wanted, fullTitle) || hasPhrase(wanted, shortTitle);
  const artistHit = candidate.artists.map(normalize).some((artist) => hasPhrase(wanted, artist));
  const overlap = titleHit ? 1 : tokenOverlap(shortTitle, wanted);
  const onlyTitle = wanted === fullTitle || wanted === shortTitle;

  const variantWords = VARIANT_WORDS.filter((word) => hasPhrase(fullTitle, word));
  const unwanted = variantWords.filter((word) => !hasPhrase(wanted, word)).length;
  const requested = variantWords.length - unwanted;

  let confidence: Confidence = "low";
  if (titleHit && artistHit) {
    confidence = unwanted > 0 ? "medium" : "high";
  } else if (titleHit && onlyTitle) {
    // The input gave no artist, so the artist cannot be checked.
    confidence = "medium";
  } else if (artistHit && overlap >= 0.6) {
    confidence = "medium";
  }

  const score = overlap * 2 + (artistHit ? 2 : 0) - Math.min(unwanted, 2) * 0.75 + requested * 0.5;

  return { score, confidence };
}

export function pickBestMatch<T extends { name: string; artists: string[] }>(
  input: string,
  candidates: T[],
): { item: T; match: MatchResult } | undefined {
  let best: { item: T; match: MatchResult } | undefined;

  for (const item of candidates) {
    const match = matchTrack(input, item);
    // Strictly greater: on a tie, Spotify's own order wins.
    if (!best || match.score > best.match.score) {
      best = { item, match };
    }
  }

  return best;
}
