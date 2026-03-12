# Spotify CLI

Control Spotify from the terminal using the Spotify Web API and Spotify Connect.

This project is for controlling the Spotify app on your devices. It does not play audio directly inside the terminal.

## What this can do

- Log into Spotify with PKCE
- List your Spotify Connect devices
- Transfer playback between devices
- Play, pause, skip, seek, shuffle, repeat, and change volume
- Search Spotify and print reusable URIs
- Show the current queue and add tracks to it
- Show recently played tracks
- Save, remove, and check items in your library

## What this does not do

- It does not stream audio in the CLI itself
- It does not cover every single Spotify feature
- It does not replace the full Spotify desktop or mobile app

## Release plan

### `v1.1.0`

Current release:

- secure Spotify login
- playback controls
- device management
- search
- queue add/view
- recent tracks
- library save/remove/check

### `v1.2.0`

Planned second release:

- broader Spotify control coverage across the remaining useful Web API surface
- direct natural-language style play flows like `spot play "fear by nf"`
- stronger playlist workflows
- better search-to-action shortcuts
- more end-to-end command coverage
- more smoke tests around real command flows

I am not calling this “100% Spotify parity” in the README because that would be misleading. The honest goal for `v1.2.0` is much fuller real-world coverage of the Spotify control surface this CLI can support.

## Requirements

- Node.js 20 or newer
- npm
- A Spotify Premium account for playback control
- A Spotify developer app with a client ID

## Important Spotify note

Spotify changed development-mode app behavior in February and March 2026.

What matters for setup:

- Development-mode playback control requires the app owner to have Spotify Premium
- Search results are limited to `10` per type
- New apps require a secure redirect URI

Primary docs:

- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide

## Quick start

```bash
npm install
npm run build
npm link
spot config set-client-id YOUR_CLIENT_ID
spot auth login
spot auth finish 'PASTE_THE_FINAL_REDIRECT_URL_HERE'
spot auth status
spot devices list
```

## Create your Spotify app

1. Go to the Spotify Developer Dashboard:

```text
https://developer.spotify.com/dashboard
```

2. Create a new app.

Use something like:

- App name: `Music Remote CLI`
- Description: `Personal command line tool for controlling Spotify playback via the Spotify Web API.`
- Website: your site or `https://example.com`

3. Add this redirect URI:

```text
https://szakacsmedia.com/spotify-cli/callback
```

4. Select `Web API`.
5. Accept the Spotify developer terms.
6. Save the app.
7. Copy the `Client ID` from the app’s Basic Information page.

You do not need the client secret for this CLI.

## Install the CLI locally

From the project folder:

```bash
npm install
npm run build
npm link
```

That gives you a global `spot` command on your machine.

## Configure the client ID

```bash
spot config set-client-id YOUR_CLIENT_ID
```

You can inspect what the CLI sees with:

```bash
spot config show
```

You can also use environment variables instead:

```bash
export SPOTIFY_CLIENT_ID=YOUR_CLIENT_ID
export SPOTIFY_REDIRECT_URI=https://szakacsmedia.com/spotify-cli/callback
```

## Log in

Start login:

```bash
spot auth login
```

The CLI will open Spotify authorization in your browser and also print the full auth URL in case the browser does not open automatically.

After you approve access, Spotify will redirect you to a URL that starts like this:

```text
https://szakacsmedia.com/spotify-cli/callback?code=...
```

Copy that full final URL from the browser and finish login:

```bash
spot auth finish 'PASTE_THE_FULL_FINAL_REDIRECT_URL_HERE'
```

Verify the connection:

```bash
spot auth status
```

## First commands to try

Check your account:

```bash
spot me
```

List your devices:

```bash
spot devices list
```

See what is currently playing:

```bash
spot playback status
```

Search for a track:

```bash
spot search "fear nf" --type track --limit 5
```

Play a track by URI:

```bash
spot playback play spotify:track:3HfKlhohNNTLIv2t9uvmzz
```

Transfer playback to a device by name:

```bash
spot devices transfer "Tyler’s Mac"
```

Pause:

```bash
spot playback pause
```

Skip:

```bash
spot playback next
spot playback previous
```

## Common commands

```bash
spot auth status
spot auth logout

spot devices list
spot devices transfer "MacBook Pro"

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
spot playback queue
spot playback add spotify:track:4uLU6hMCjMI75M1A2tKUQC

spot search "daft punk"
spot recent

spot library save spotify:album:4m2880jivSbbyEGAKfITCa
spot library contains spotify:track:4uLU6hMCjMI75M1A2tKUQC
spot library remove spotify:track:4uLU6hMCjMI75M1A2tKUQC
```

## Where config is stored

```text
~/.config/spotify-cli/config.json
~/.config/spotify-cli/tokens.json
~/.config/spotify-cli/auth-session.json
```

## Troubleshooting

### `spot auth status` says not connected

Run the login flow again:

```bash
spot auth login
spot auth finish 'PASTE_THE_FULL_FINAL_REDIRECT_URL_HERE'
```

### Spotify says there is no active device

Open Spotify on your phone, desktop, or speaker first, then run:

```bash
spot devices list
```

### A playback command fails with 403 or 404

Most often this means one of these:

- the Spotify app is not open on any active device
- the selected device is restricted
- the Spotify account used for the developer app is not Premium

### The browser did not open during login

The CLI prints the authorization URL. Paste that URL into your browser manually, approve access, then copy the final redirect URL into:

```bash
spot auth finish 'PASTE_THE_FULL_FINAL_REDIRECT_URL_HERE'
```

### `npm link` finished but `spot` is not found

Rebuild and relink:

```bash
npm run build
npm link
hash -r
```

## Development

```bash
npm test
npm run build
node dist/index.js --help
```

## License

MIT
