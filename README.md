<h1 align="center">Spotify CLI</h1>

<p align="center">
  Control Spotify from the command line with the Spotify Web API and Spotify Connect.<br>
  Made for people and for AI agents.
</p>

<p align="center">
  <a href="https://github.com/tszaks/spotify-cli/actions/workflows/ci.yml"><img src="https://github.com/tszaks/spotify-cli/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tszaks/spotify-cli/releases/latest"><img src="https://img.shields.io/github/v/release/tszaks/spotify-cli" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tszaks/spotify-cli" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-20%2B-brightgreen" alt="Node 20 or later">
</p>

```console
$ spot --help
Usage: spot [options] [command]

Control Spotify from the command line

Commands:
  guide                         Print the short manual for agents
  config                        Manage local CLI config
  auth                          Spotify login helpers
  me                            Show the current Spotify account
  play [options] [target...]    Find something by name and play it, in one step
  now                           Show what plays now, in a small form
  search [options] <query>      Search Spotify and print URIs you can reuse in
                                other commands
  resolve [options] [songs...]  Change many song names into Spotify URIs in one
                                step
  recent [options]              Show recently played tracks
  taste [options]               Show what you like: top artists, top songs,
                                recent and saved songs
  devices                       Inspect Spotify Connect devices
  playback                      Control Spotify playback
  playlist                      Make and change playlists
  dj                            Run a DJ set: a list of songs that plays in
                                order and can change direction
  library                       Save or inspect library items
```

Spotify CLI controls the Spotify app running on your phone, desktop, or speaker. It does not play audio inside the terminal. It is for people who live in a terminal and want to pause, skip, search or queue a track without reaching for the mouse. It is also for AI agents: an agent can play music by name, run a DJ set, and make playlists, with one command for each job.

It uses Spotify's official Web API with the PKCE login flow, so you never handle a client secret. Tokens stay in a file on your machine. The command is called `spot`.

## Features

- **Play by name.** `spot play "fear nf"` finds the song and plays it. No URI necessary.
- **DJ sets.** `spot dj start` plays a list of songs in order. `spot dj status` shows what was skipped. `spot dj steer` changes the songs that come next.
- **Playlists from song names.** `spot playlist create "Road trip" --from songs.txt` makes a playlist in one step and reports the songs that Spotify does not have.
- **Taste memory.** A background watcher records each song you play and each skip. `spot feel` keeps your loves and bans, and bans are enforced. `spot taste profile` gives an agent all of it before a set, and `spot taste score` shows if the agent's songs get fewer skips over time.
- **Made for agents.** One JSON object for each command, error codes with a next step, and a short manual (`spot guide`).
- **Spotify PKCE login.** No client secret, and a secure redirect finishes the flow.
- **Device control.** List your Spotify Connect devices and transfer playback between them.
- **Full playback control.** Play, pause, skip, seek, shuffle, repeat, and set volume.
- **Queue, history and library.** View the queue, add tracks, show recent tracks, save and remove items.

## Requirements

- Node.js 20+
- npm
- A Spotify Premium account for playback control
- A Spotify developer app with a client ID

## Install

```bash
git clone https://github.com/tszaks/spotify-cli.git
cd spotify-cli
npm install
npm run build
npm link
spot --help
```

That gives you a global `spot` command. The package is not published to npm.

## Create a Spotify app

1. Go to `https://developer.spotify.com/dashboard`
2. Create a new app
3. Set the redirect URI to:

```text
https://szakacsmedia.com/spotify-cli/callback
```

4. Select `Web API`
5. Save the app
6. Copy the app's `Client ID`

You do not need a client secret for this CLI.

## Configure the CLI

```bash
spot config set-client-id YOUR_CLIENT_ID
spot config show
```

If you want to override the default redirect URI:

```bash
spot config set-redirect-uri https://szakacsmedia.com/spotify-cli/callback
```

You can also use environment variables:

```bash
export SPOTIFY_CLIENT_ID=YOUR_CLIENT_ID
export SPOTIFY_REDIRECT_URI=https://szakacsmedia.com/spotify-cli/callback
```

## Log in

Start the login flow:

```bash
spot auth login
```

Spotify will send you to a browser. After you approve access, it will redirect to:

```text
https://szakacsmedia.com/spotify-cli/callback?code=...
```

Copy that full final URL and finish the login:

```bash
spot auth finish 'PASTE_THE_FULL_CALLBACK_URL_HERE'
spot auth status
```

## Quick start

```bash
spot play "fear nf"
spot now
spot play "discovery daft punk" --type album
spot play "daft punk" --type artist
spot play "nf the search" --queue
spot playback pause
```

## For AI agents

Give the agent a shell and this one line: "Run `spot guide` to learn how to control Spotify."

`spot guide` prints [skills/spot/SKILL.md](skills/spot/SKILL.md). To install it as a skill, copy or link the `skills/spot` folder into the skills folder of your agent.

### Output

When no terminal is attached, each command prints one JSON object on one line. In a terminal, it prints text. `--json` and `--text` force a mode, and so does `SPOT_OUTPUT=json` or `SPOT_OUTPUT=text`.

```console
$ spot play "fear nf" | cat
{"ok":true,"action":"playing","item":{"uri":"spotify:track:3HfKlhohNNTLIv2t9uvmzz","type":"track","label":"FEAR - NF"},"device":{"id":"...","name":"iPhone","type":"Smartphone","active":true,"volume":100,"restricted":false},"woke":false}
```

### Errors

An error has a code, the message from Spotify, and a hint with the next step. The exit code is not zero.

```json
{"ok":false,"error":{"code":"NO_ACTIVE_DEVICE","message":"No device is active, and more than one device is available.","hint":"Run the command again with --device <name>.","devices":[{"name":"iPhone"},{"name":"Patio Amp"}]}}
```

| Code | Exit code | Meaning |
| --- | --- | --- |
| `BAD_INPUT` | 2 | The command or a value is wrong. |
| `NOT_LOGGED_IN`, `AUTH_EXPIRED`, `SCOPE_MISSING` | 3 | A person must run `spot auth login`. |
| `NO_ACTIVE_DEVICE`, `DEVICE_NOT_FOUND` | 4 | No device can play. The error lists the available devices. |
| `NOT_FOUND` | 5 | Spotify has no such item. |
| `RATE_LIMITED`, `QUOTA_EXCEEDED` | 6 | Wait for `retryAfterSeconds`. |
| `PREMIUM_REQUIRED`, `FORBIDDEN` | 7 | Spotify refused the action. |
| `NETWORK`, `SPOTIFY_ERROR` | 8 | No connection, or a problem at Spotify. |

### Devices

`spot` never guesses between two speakers. When no device is active and more than one is available, it stops and lists them. Then use `--device <name>`, or set a default with `spot config set-default-device <name>`.

When Spotify is closed on all devices, `--wake` opens the Spotify app on this computer (macOS only). The sound then comes from this computer.

## Common commands

### Play

```bash
spot play "fear nf"
spot play "random access memories" --type album
spot play "morning coffee" --type playlist
spot play "road trip" --mine          # one of your own playlists, by name
spot play "nf the search" --queue     # next, the current song continues
spot play                             # resume
spot now
```

### DJ sets

A set is a list of songs that plays in order. `spot` keeps the set in one playlist with the name `spot DJ`, because the Spotify queue cannot be cleared or put in a new order.

```bash
spot dj start --name "Deep focus" --note "calm, no vocals" --from songs.txt
spot dj status      # current song, played, skipped, remaining
spot dj steer "Tycho - Awake" "Bonobo - Kerala"   # replaces the songs that come next
spot dj stop        # pause and final report
```

`songs.txt` has one song for each line, as `Artist - Title`, a Spotify URI, or a link. Use `--from -` to read the list from stdin.

`skipped` means: a song before the current song that Spotify did not record as played. Spotify records a song after 30 seconds of play.

### Playlists

```bash
spot playlist list
spot playlist show "Road trip"
spot playlist create "Road trip" --description "Windows down" --from songs.txt
spot playlist create "Focus" "Tycho - Awake" "Bonobo - Kerala" --play
spot playlist add "Road trip" "NF - Fear"
spot playlist replace "Road trip" --from songs.txt
spot playlist remove "Road trip" spotify:track:3HfKlhohNNTLIv2t9uvmzz
spot playlist update "Road trip" --name "Road trip 2"
```

A new playlist is private. Add `--public` to change that. The playlist argument is the name of one of your playlists, an id, a URI, or a link.

### Song names to URIs

```bash
spot resolve "NF - Fear" "Daft Punk - Around the World"
spot resolve --from songs.txt
```

`resolve` reports a song as `missed` when no result has the title and the artist. This catches a wrong name and a song that is not real. Add `--loose` to accept weak matches.

### Taste

```bash
spot taste
```

One reply with your top artists, top songs, recent songs and saved songs. A part that Spotify refuses is listed in `unavailable` with the cause. The other parts stay correct.

### Taste memory

Spotify forgets nothing, but it tells apps very little. `spot` keeps its own record, so an agent can learn your taste over time.

```bash
spot watch install            # macOS: record each song you play, in the background (start at login)
spot watch status             # is it running, and when did it last check?

spot feel love                # you like the song that plays now
spot feel ban "Artist - Title" --why "too slow"
spot feel ban --artist "Artist - Title"   # never play this artist
spot feel clear "Artist - Title"          # forget the earlier word

spot taste profile            # what the tool learned: notes, bans, favourites, skips, situations, score
spot taste note "No vocals when working"
spot taste score              # skip rate of the agent's songs for each week

spot history import ~/Downloads/my_spotify_data   # years of plays from a Spotify data download
```

- The watcher asks Spotify what plays every 20 seconds while music plays, and every 1 to 2 minutes when nothing plays. A song that changes before its end is a skip. A song that stops (pause, app closed) is not.
- Bans apply to DJ sets and to playlists that `spot` makes. `--include-banned` turns this off for one command. `spot play` of one song is not blocked: that is a direct request.
- `taste-notes.md` is plain text. Edit it as you like. "Rules you said" is for your own rules.
- Your Spotify data download: spotify.com, Account, Privacy, "Extended streaming history". It can take up to 30 days. Unzip it, then import the folder.
- All of this stays on your computer, in `~/.config/spotify-cli/`.

### Auth

```bash
spot auth login
spot auth finish 'PASTE_THE_FULL_CALLBACK_URL_HERE'
spot auth status
spot auth logout
```

### Devices

```bash
spot devices list
spot devices transfer "MacBook Pro"
spot config set-default-device "MacBook Pro"
```

### Playback

```bash
spot playback status
spot playback play
spot playback play spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
spot playback play "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
spot playback pause
spot playback next
spot playback previous
spot playback volume 35
spot playback seek 60000
spot playback shuffle on
spot playback repeat context
```

### Queue

```bash
spot playback queue
spot playback add spotify:track:4uLU6hMCjMI75M1A2tKUQC spotify:track:3HfKlhohNNTLIv2t9uvmzz
```

### Account, search and recent

```bash
spot me
spot search "daft punk"
spot recent --limit 50
```

### Library

```bash
spot library save spotify:album:4m2880jivSbbyEGAKfITCa
spot library contains spotify:track:4uLU6hMCjMI75M1A2tKUQC
spot library remove spotify:track:4uLU6hMCjMI75M1A2tKUQC
```

## Spotify setup notes

Spotify changed parts of its development-mode behavior in early 2026. The main things that matter here:

- The owner of the developer app needs Spotify Premium. If Premium stops, all requests fail. After Premium starts again, Spotify can take some hours to accept requests.
- New apps need a secure redirect URI
- Search results are limited to `10` per type in development mode
- Spotify gives no song recommendations to apps in development mode. The person or the agent selects the songs.
- You can read the songs of a playlist only if you own it or collaborate on it
- A login lasts 180 days. Then a person must log in again.
- After an update that adds a permission (v2.0.0 adds `user-top-read` for `spot taste`), run `spot auth login` one time

Relevant docs:

- `https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow`
- `https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens`
- `https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide`

## Troubleshooting

### `spot auth status` says you are not connected

Run the login flow again:

```bash
spot auth login
spot auth finish 'PASTE_THE_FULL_CALLBACK_URL_HERE'
```

### Spotify says there is no active device

Open Spotify on your phone, desktop, or speaker first, then run:

```bash
spot devices list
```

Or add `--wake` to a play command to open Spotify on this computer.

### The error is `PREMIUM_REQUIRED`

The Spotify account that owns the developer app has no active Premium plan, or the plan changed in the last hours. Wait, then try again.

### The error is `SCOPE_MISSING`

The login is older than a permission that the command needs. Run the login flow again.

### `spot` is not found after `npm link`

```bash
npm run build
npm link
hash -r
```

## Config files

```text
~/.config/spotify-cli/config.json
~/.config/spotify-cli/tokens.json        (mode 600: only you can read it)
~/.config/spotify-cli/auth-session.json
~/.config/spotify-cli/dj-session.json    (the current DJ set)
~/.config/spotify-cli/listening.jsonl    (one line for each song that ended)
~/.config/spotify-cli/feelings.jsonl     (loves, bans)
~/.config/spotify-cli/taste-notes.md     (the taste file that agents read; you can edit it)
~/.config/spotify-cli/watch-state.json, watch.lock, watch.log   (the watcher)
```

## Roadmap

Current release: `v2.0.1`

Ideas for later, not scheduled:

- mood and style labels for songs from Last.fm (Spotify no longer gives this data)
- a login that finishes by itself with a local callback address
- an MCP server mode for agents that have no shell

## Development

```bash
npm test
npm run build
node dist/index.js --help
```

The tests run each command against a fake Spotify that lives in memory (`test/helpers/fake-spotify.ts`). They never call the real Spotify API and never read your login.

CI runs `npm ci`, `npm run build` and `npm test` on Node 20 and 22. A design note from the first build is in [docs/plans](docs/plans/2026-03-12-spotify-cli-design.md).

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security problems go through [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Docs: [agent manual](skills/spot/SKILL.md) · [design note](docs/plans/2026-03-12-spotify-cli-design.md) · [AGENTS.md](AGENTS.md) · [changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © 2026 Tyler Szakacs
