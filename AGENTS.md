# Spotify CLI

A TypeScript CLI (`spot`) that controls Spotify through the official Web API and Spotify Connect. ES modules, Node 20+, Commander for the command tree, Vitest for tests.

## Build, test
- Install: `npm install` (or `npm ci`).
- Build: `npm run build` (compiles to `dist/`, which is git-ignored).
- Test: `npm test`. Run the **whole** suite and the build before you say something works.
- Run from source: `npm run dev -- <args>`. Run the build: `node dist/index.js <args>`.
- Commands that talk to Spotify need a real token. Do not run `spot auth login` or any playback command unless asked; they act on the user's account.

## Code map
- `src/index.ts`: the Commander command tree and every command handler.
- `src/spotify-client.ts`: authenticated API wrapper, token refresh, the `REQUIRED_SCOPES` list.
- `src/pkce.ts`, `src/auth-session.ts`, `src/auth-callback.ts`: PKCE login and the redirect finish step.
- `src/config-store.ts`, `src/token-store.ts`, `src/paths.ts`: files under `~/.config/spotify-cli/`.
- `src/spotify-uri.ts`, `src/input-validation.ts`, `src/playback-utils.ts`, `src/output.ts`: parsing, validation and printing.
- `test/`: Vitest tests for the pure pieces. `docs/plans/`: the original design note.

## Conventions
- Match the surrounding code: naming, comment density, idiom. Comments say **why**, not what.
- Keep output plain and script friendly. No styling dependencies.
- Keep dependencies minimal. Do not add any without discussion.
- Never log, print or commit tokens, client IDs, callback URLs with a `code`, or anything from `~/.config/spotify-cli/`.
- Tests must not call the real Spotify API.
- Update `README.md` and `CHANGELOG.md` when a command or option changes.
