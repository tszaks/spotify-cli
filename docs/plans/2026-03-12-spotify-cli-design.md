# Spotify CLI Design

Date: 2026-03-12

## Goal

Create a simple local CLI that controls Spotify through the official Web API, with a strong bias toward playback control and low setup friction.

## Assumptions

- The tool should be fully autonomous to scaffold and verify.
- Audio playback itself should still happen in Spotify clients, not in the terminal.
- The CLI should favor current Spotify Web API behavior, including 2026 development-mode changes.

## Design

- Use a small TypeScript CLI with Commander.
- Use Spotify Authorization Code with PKCE so no client secret is needed locally.
- Store config and tokens in `~/.config/spotify-cli/`.
- Use one API wrapper for authenticated Spotify requests and token refresh.
- Keep output plain and script-friendly without extra styling dependencies.

## Command Surface

- `config`: store client ID and redirect URI
- `auth`: login, logout, status
- `me`: print the current account
- `devices`: list and transfer playback
- `playback`: status, play, pause, next, previous, volume, seek, shuffle, repeat, queue, add
- `search`: print reusable URIs
- `recent`: show recently played tracks
- `library`: save, remove, contains

## Verification

- Unit tests for PKCE helpers, token expiry logic, search limit handling, device resolution, and Spotify URI normalization
- Build verification for the compiled CLI
- Help-output verification for top-level and key subcommands
