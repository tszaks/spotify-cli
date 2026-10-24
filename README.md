<h1 align="center">Spotify CLI</h1>

<p align="center">
  Control Spotify from the command line with the Spotify Web API and Spotify Connect.
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
  config                    Manage local CLI config
  auth                      Spotify login helpers
  me                        Show the current Spotify account
  search [options] <query>  Search Spotify and print URIs you can reuse in other
                            commands
  recent [options]          Show recently played tracks
  devices                   Inspect Spotify Connect devices
  playback                  Control Spotify playback
  library                   Save or inspect library items
```

Spotify CLI controls the Spotify app running on your phone, desktop, or speaker. It does not play audio inside the terminal. It is for people who live in a terminal and want to pause, skip, search or queue a track without reaching for the mouse, and for scripts that need to drive Spotify.

It uses Spotify's official Web API with the PKCE login flow, so you never handle a client secret. Tokens stay in a file on your machine. The command is called `spot`.

## Features

- **Spotify PKCE login.** No client secret, and a secure redirect finishes the flow.
- **Device control.** List your Spotify Connect devices and transfer playback between them.
- **Full playback control.** Play, pause, skip, seek, shuffle, repeat, and set volume.
- **Search that prints reusable URIs.** Paste the result straight into `spot playback play`.
- **Queue and history.** View the current queue, add tracks, and show recently played tracks.
- **Library.** Save, remove, and check library items.
- **Script friendly.** Plain output with no styling dependencies.

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
spot devices list
spot playback status
spot search "fear nf" --type track --limit 5
spot playback play spotify:track:3HfKlhohNNTLIv2t9uvmzz
spot playback pause
```

## Common commands

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
spot playback add spotify:track:4uLU6hMCjMI75M1A2tKUQC
```

### Account, search and recent

```bash
spot me
spot search "daft punk"
spot recent
```

### Library

```bash
spot library save spotify:album:4m2880jivSbbyEGAKfITCa
spot library contains spotify:track:4uLU6hMCjMI75M1A2tKUQC
spot library remove spotify:track:4uLU6hMCjMI75M1A2tKUQC
```

## Spotify setup notes

Spotify changed parts of its development-mode behavior in early 2026. The main things that matter here:

- Playback control requires Spotify Premium
- New apps need a secure redirect URI
- Search results are limited to `10` per type in development mode

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

### Playback commands return `403` or `404`

Usually one of these is true:

- Spotify is not open on any active device
- The selected device is restricted
- The account tied to the developer app is not Premium

### `spot` is not found after `npm link`

```bash
npm run build
npm link
hash -r
```

## Config files

```text
~/.config/spotify-cli/config.json
~/.config/spotify-cli/tokens.json
~/.config/spotify-cli/auth-session.json
```

## Roadmap

Current release: `v1.1.0`

Next release target: `v1.2.0` (not scheduled)

- better search-to-play shortcuts
- stronger playlist workflows
- broader command coverage across the useful Spotify control surface
- more end-to-end smoke coverage

## Development

```bash
npm test
npm run build
node dist/index.js --help
```

CI runs `npm ci`, `npm run build` and `npm test` on Node 20 and 22. A design note from the first build is in [docs/plans](docs/plans/2026-03-12-spotify-cli-design.md).

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security problems go through [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Docs: [design note](docs/plans/2026-03-12-spotify-cli-design.md) · [AGENTS.md](AGENTS.md) · [changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © 2026 Tyler Szakacs
