# Changelog

All notable changes to Spotify CLI are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Ideas for a later release, not committed to a date:

- A login that finishes by itself with a local callback address.
- An MCP server mode.

## [2.0.2] - 2026-11-16

### Fixed
- `spot watch install` wrote the versioned Node path (for example `/opt/homebrew/Cellar/node/26.12.0/bin/node`), so the watcher stopped after a Node upgrade. It now uses the `node` link on PATH, for example `/opt/homebrew/bin/node`. Run `spot watch install` again to update the file.

## [2.0.1] - 2026-11-16

Taste memory. An agent can now learn the user's taste over time, and the tool shows if it learns.

### Added
- `spot watch run`: records each song that plays, on all devices, in `listening.jsonl`: how long it played, if it was skipped, the device, and if an agent's DJ set selected it. It asks Spotify every 20 seconds while music plays, and less often when nothing plays.
- `spot watch install` / `uninstall` / `status`: keep the watcher running in the background on macOS (launchd).
- `spot feel love|meh|ban|clear [song] [--artist] [--why]`: record what the user said about a song or an artist. With no song, it uses the song that plays now.
- Bans are enforced: `dj start`, `dj steer` and `playlist create|add|replace` leave banned songs out and list them in `blocked`. `--include-banned` keeps them.
- `spot taste profile`: one reply with the taste notes, the user's words, favourites, often-skipped artists and songs, situations (time of day), devices, the last sets and the weekly score.
- `spot taste note`: add one lesson to `taste-notes.md`, the file that agents read before each set. The user can edit it.
- `spot taste score`: skip rate of agent-selected songs for each week, with new songs and known songs apart.
- `spot history import`: import years of plays from a Spotify data download (Extended streaming history, or the short account data). Safe to run again.
- `spot dj stop` tells the agent how to keep the lessons of the set.

## [2.0.0] - 2026-11-16

The agent release. An AI agent can now play music by name, run a DJ set and make playlists, with one command for each job.

### Changed (breaking)
- When no terminal is attached, each command prints one JSON object with an `ok` field. Text output stays the default in a terminal. `--text` or `SPOT_OUTPUT=text` gives the old text to a script.
- `playback status`, `playback queue`, `me` and `library contains` print smaller JSON with new field names.
- Errors have a code and a hint, and each group of errors has its own exit code. See the README.
- `spot recent` accepts `--limit` up to 50 (was 10).

### Added
- `spot play`: find a song, album, artist or playlist by name and play it. `--queue` adds a song to the queue. `--mine` finds one of your own playlists.
- `spot now`: a small summary of what plays.
- `spot resolve`: change a list of song names into Spotify URIs in one step. It reports a song that does not exist as missed.
- `spot playlist`: `list`, `show`, `create`, `add`, `replace`, `remove`, `update`. Songs are given by name, URI or link, as arguments or with `--from <file>`.
- `spot dj`: `start`, `status`, `steer`, `stop`. A set plays in order from one playlist. `status` shows played, skipped and remaining songs.
- `spot taste`: top artists, top songs, recent songs and saved songs in one reply.
- `spot guide` and `skills/spot/SKILL.md`: the short manual for agents.
- `--wake` on play commands: open Spotify on this computer when no device is available (macOS).
- `spot config set-default-device`: where music starts when no device is active.
- `playback add` accepts more than one URI.
- The login asks for three more permissions: `playlist-read-private`, `playlist-read-collaborative` and `user-top-read`. Run `spot auth login` one time to get them.

### Fixed
- A plain-text reply from Spotify showed as `Unexpected token ... is not valid JSON`. The real message now shows, for example the message about Premium.
- The login file is now readable only by its owner (mode 600) and is written in one step.
- Two commands that refresh the login at the same time no longer log each other out.
- A rate limit (HTTP 429) with a short wait is retried. A long wait is reported with `retryAfterSeconds`.
- Shared links with a language part (`/intl-de/track/...`) are accepted.
- `spot play` selects the search result that fits the words, not the first result.
- A device can be named by a part of its name, when only one device matches.
- `config show` printed the full stored client ID. It now cuts it short in both blocks.

## [1.1.0] - 2026-03-12

First public release.

### Added
- PKCE login flow, with a secure redirect-based `auth finish` step.
- Spotify Connect device listing and transfer.
- Playback control commands.
- Queue inspection and add-to-queue.
- Search that prints reusable URIs.
- Recently played tracks.
- Generic library save, remove, and contains support.
