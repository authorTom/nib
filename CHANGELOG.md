# Changelog

What changed in each release, written for someone deciding whether to upgrade.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Deckle
follows [Semantic Versioning](https://semver.org/) — see
[Versioning](README.md#versioning) for what a major, minor and patch bump mean
here.

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-08-13

The first tagged release. Deckle has been running and deployable for a while;
what is new is that a given build can now be named, pinned, and rolled back to.

Nothing about the app itself changes when you upgrade to it, but **what
`:latest` means does** — see below.

### Added

- **Versioning.** Deckle follows Semantic Versioning from this release on. The
  version is shown in the keyboard sheet (`?`), logged at server startup, and
  returned by `GET /api/v1/health` as `version`, so a bug report or an agent can
  name the build it is talking to. The API's OpenAPI document reports it as
  `info.version`.
- **Released image tags.** `:1.0.0` never moves, `:1.0` takes fixes, `:1` takes
  fixes and features but never a breaking change, and `:latest` follows the
  newest release.
- **This changelog.**

### Changed

- **`:latest` now means the newest release, not the newest commit.** It used to
  be republished on every push to `main`, so `docker compose pull` took whatever
  had merged most recently, finished or not. If you were relying on that to
  track development, switch to `:edge` — otherwise there is nothing to do, and
  your next pull becomes a considered release rather than a branch tip.

### Deprecated

- The pre-rename `NIB_*` configuration names and the `.nib` data folder are
  still read, and **will keep being read for the whole 1.x series**. They will
  be removed no earlier than 2.0.0. Rename `NIB_*` to `DECKLE_*` in your `.env`
  whenever it suits; the server logs which deprecated names it honoured at
  startup.

### The app, as of 1.0.0

For anyone arriving here first, this release contains: live WYSIWYG Markdown
editing over plain `.md` files; three storage backends (a folder on disk, the
browser's private storage, or a volume on your own server) behind one interface;
a folder tree with drag-and-drop, spring-loaded folders and a *Move to another
folder…* dialog; import of Markdown files, folders and ZIPs into a folder you
choose; a Todoist-style task planner and bookmark collections stored inside the
library; per-note version history and a recycle bin; an AI assistant that can
search and edit the library with every change shown as an approvable diff;
a command palette; light and dark mode with seven palettes; a responsive layout
with drawers on a phone; and a token-authenticated REST API at `/api/v1`
described by a self-served OpenAPI 3.1 document.

[Unreleased]: https://github.com/authorTom/deckle/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/authorTom/deckle/releases/tag/v1.0.0
