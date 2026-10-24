# Contributing to Spotify CLI

Thanks for helping. Spotify CLI is a small TypeScript tool with a narrow job: control Spotify from a terminal using the official Web API, with low setup friction.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For bugs, open an issue with the template. The exact command, its output, and your Node version help most.
- For features, open an issue first and describe the problem you want to solve.
- Small fixes (typos, clear bugs) can go straight to a pull request.
- Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Setup

You need Node.js 20 or newer and npm.

```sh
git clone https://github.com/tszaks/spotify-cli.git
cd spotify-cli
npm install
npm run build
```

Run from source without building with `npm run dev -- --help`. Run the built command with `node dist/index.js --help`.

To try commands against Spotify you need your own developer app and client ID. See the README.

## Run the tests

```sh
npm test
npm run build
```

Run both before you open a pull request. Tests use Vitest and live in `test/`. Do not add tests that call the real Spotify API or need a token.

## Code style

- **Match the surrounding code.** Same naming, same comment density, same idiom as the file you are editing. There is no formatter to run, so read the neighbors.
- TypeScript in strict mode, ES modules.
- Keep dependencies minimal. No new dependencies without discussion.
- Comments explain *why*, not *what*.

## Credentials safety

Never commit a client ID, token, callback URL with a `code=` value, or anything from `~/.config/spotify-cli/`. Redact them from issues and logs.

## Pull request checklist

- [ ] `npm test` and `npm run build` pass locally.
- [ ] New behavior has a test.
- [ ] The change is small and focused. Unrelated cleanups go in their own pull request.
- [ ] The code matches the surrounding style and adds no dependency.
- [ ] README updated if a command or option changed.
- [ ] A line added under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Using AI agents to contribute

Fine, as long as you read and understand what you submit and the checklist above is true. [AGENTS.md](AGENTS.md) tells coding agents how this repository works.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
