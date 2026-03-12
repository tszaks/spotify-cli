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

export function formatSearchItemSummary(item: Record<string, any> | null | undefined): string {
  if (!item) {
    return "Unknown item";
  }

  if (Array.isArray(item.artists) && item.artists.length > 0) {
    const artists = item.artists
      .map((artist: { name?: string }) => artist.name)
      .filter(Boolean)
      .join(", ");

    return `${item.name ?? "Unknown item"} - ${artists}`;
  }

  if (item.owner?.display_name) {
    return `${item.name ?? "Unknown item"} - ${item.owner.display_name}`;
  }

  return item.name ?? "Unknown item";
}
