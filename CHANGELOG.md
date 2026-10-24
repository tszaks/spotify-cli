# Changelog

All notable changes to Spotify CLI are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned for a later release, not committed to a date:

- Natural-language style play commands.
- Richer playlist actions.
- Broader command coverage across the supported Spotify Web API control surface.
- Stronger end-to-end smoke coverage.
- Smoother search-to-action workflows.

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
