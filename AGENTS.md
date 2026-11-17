# Spotify CLI

A TypeScript CLI (`spot`) that controls Spotify through the official Web API and Spotify Connect. ES modules, Node 20+, Commander for the command tree, Vitest for tests.

## Build, test
- Install: `npm install` (or `npm ci`).
- Build: `npm run build` (compiles to `dist/`, which is git-ignored).
- Test: `npm test`. Run the **whole** suite and the build before you say something works.
- Run from source: `npm run dev -- <args>`. Run the build: `node dist/index.js <args>`.
- Commands that talk to Spotify need a real token. Do not run `spot auth login` or any playback command unless asked; they act on the user's account.

## Code map
- `src/index.ts`: the binary. It only calls `main` in `src/cli.ts`.
- `src/cli.ts`: the Commander command tree, the output mode (JSON or text) and the error output. Each handler returns `{ data, text }`.
- `src/errors.ts`: `SpotError`, the error codes, the exit codes, and the mapping from a Spotify HTTP reply to a code and a hint.
- `src/spotify-client.ts`: authenticated API wrapper, token refresh with a file lock, retry rules, the `REQUIRED_SCOPES` list.
- `src/devices.ts`: device list and `ensureDevice`, which decides where music plays.
- `src/playback.ts`, `src/search.ts`, `src/playlists.ts`, `src/taste.ts`: one module for each area of the Spotify API.
- `src/match.ts`, `src/resolve.ts`: decide if a search result is the song that a line of text asked for.
- `src/dj.ts`: the DJ set (a playlist plus `dj-session.json`).
- `src/shapes.ts`: the small output shapes (track, device, playlist).
- `src/runtime.ts`: side effects that tests replace (sleep, start the Spotify app).
- `src/pkce.ts`, `src/auth-session.ts`, `src/auth-callback.ts`: PKCE login and the redirect finish step.
- `src/config-store.ts`, `src/token-store.ts`, `src/paths.ts`: files under `~/.config/spotify-cli/`.
- `skills/spot/SKILL.md`: the manual for agents that use the CLI. `spot guide` prints it.
- `test/helpers/fake-spotify.ts`: an in-memory copy of the Spotify API. `test/helpers/cli.ts` runs a command as an agent does.

## Rules of the design
- An agent is the main user. Each command prints one JSON object when no terminal is attached, with `ok` first.
- An error names the cause and the next step: throw `SpotError` with a code and a hint. Never let a raw exception reach the user.
- Never guess where music plays or which playlist is meant. When two things match, stop and list them.
- Find the songs and the device before you change the account, so a failure leaves nothing half done.
- One job is one command. If an agent needs three calls for a common job, add a command.
- Spotify changes this API often. Read the current reference before you add an endpoint. `spot` uses the February 2026 paths (`/me/playlists`, `/playlists/{id}/items`, `/me/library`).

## Conventions
- Match the surrounding code: naming, comment density, idiom. Comments say **why**, not what.
- Keep text output plain. No styling dependencies.
- Keep dependencies minimal. Do not add any without discussion.
- Never log, print or commit tokens, client IDs, callback URLs with a `code`, or anything from `~/.config/spotify-cli/`.
- Tests must not call the real Spotify API. `test/helpers/env.ts` blocks the network and moves the config folder to a temp folder.
- A new command needs a test that runs it through `spot()` in `test/helpers/cli.ts`.
- Update `README.md`, `CHANGELOG.md` and `skills/spot/SKILL.md` when a command or option changes.
