# Security policy

## Supported versions

Only the latest release of Spotify CLI gets security fixes.

| Version | Supported |
|---|---|
| 1.1.x (latest) | Yes |
| Older | No |

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. If that is not available to you, email tyler@szakacsmedia.com.

Please include:

- What you found and what an attacker could do with it.
- Steps to reproduce.
- Your OS, Node version and Spotify CLI version (`spot --version`).

You can expect a first reply within a few days. Spotify CLI is maintained by one person, so a fix may take longer, but you will get updates. Once a fix is released you will be credited in the changelog unless you prefer to stay anonymous.

## What counts

Spotify CLI logs into your Spotify account and can change what you play and what is in your library. These areas matter most:

- **Tokens.** The access and refresh tokens are saved as plain JSON in `~/.config/spotify-cli/tokens.json`. Anyone who can read that file can act as you on Spotify within the granted scopes. The CLI does not set restrictive file permissions itself, so keep that folder private. `spot auth logout` clears the saved token.
- **Scopes.** Login asks for playback control, playback and recently played read access, library read and modify, follow read and modify, playlist modify (public and private), and read of your account profile.
- **The login flow.** The PKCE flow uses a redirect page and a pasted callback URL. The callback URL contains a one-time `code`. Do not share it. Anything that leaks the code, the verifier or the tokens is a vulnerability.
- **No client secret.** The CLI never needs one. A report that the client ID is public is not a vulnerability.

Spotify CLI talks only to Spotify's API and accounts servers. It has no analytics or crash reporting.
