# Spotify CLI

Control Spotify from the terminal using the Spotify Web API and Spotify Connect.

This tool is focused on remote control and account actions, not piping audio through the CLI itself.

## What it does

- Browser-based Spotify login with PKCE
- Device discovery and playback transfer
- Play, pause, next, previous, seek, volume, shuffle, repeat
- Queue inspection and add-to-queue
- Search that prints reusable Spotify URIs
- Recent playback history
- Save, remove, and check library items, including newer generic library flows

## Requirements

- Node.js 20+ recommended
- A Spotify app client ID from the Spotify Developer Dashboard
- A Spotify Premium account for playback control

## Important Spotify note for 2026

Spotify's Development Mode changes were rolled out on **March 9, 2026** for existing development-mode apps.

What matters here:

- The app owner now needs an active Spotify Premium subscription for development-mode playback control.
- Search requests are capped at `10` results per type.
- Generic library endpoints like `PUT /me/library` and `DELETE /me/library` should be used instead of older content-specific save/remove endpoints.

Source docs:

- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide

## Setup

1. Create a Spotify app at the Spotify Developer Dashboard.
2. Add this redirect URI to the app allowlist:

```text
http://127.0.0.1:45456/callback
```

3. Install dependencies and build:

```bash
npm install
npm run build
```

4. Link the CLI locally:

```bash
npm link
```

5. Save your client ID:

```bash
spot config set-client-id YOUR_SPOTIFY_CLIENT_ID
```

6. Log in:

```bash
spot auth login
```

If the browser does not open automatically, the CLI prints the exact Spotify auth URL so you can paste it into any browser yourself.

## Common commands

```bash
spot auth status
spot me
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

## Config

Config is stored locally at:

```text
~/.config/spotify-cli/config.json
~/.config/spotify-cli/tokens.json
```

Environment variables also work:

```bash
export SPOTIFY_CLIENT_ID=YOUR_SPOTIFY_CLIENT_ID
export SPOTIFY_REDIRECT_URI=http://127.0.0.1:45456/callback
```

## Development

```bash
npm test
npm run build
node dist/index.js --help
```
