export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printHeading(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

export function formatTrackSummary(track: Record<string, any> | null | undefined): string {
  if (!track) {
    return "Nothing is currently playing.";
  }

  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist: { name?: string }) => artist.name).filter(Boolean).join(", ")
    : "Unknown artist";

  return `${track.name ?? "Unknown track"} - ${artists}`;
}
