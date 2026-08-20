# Changelog

What changed in each release, written for someone deciding whether to upgrade.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); Deckle
follows [Semantic Versioning](https://semver.org/) — see
[Versioning](README.md#versioning) for what a major, minor and patch bump mean
here.

## [Unreleased]

Nothing yet.

## [1.4.0] — 2026-08-20

### Added

- **See and switch the model without leaving what you're doing.** The assistant
  names its model above the conversation, and that name is the switch: it lists
  every provider you have configured, so moving from a local model to Claude —
  or from Opus to Haiku for something small — is one click. Providers you
  haven't set up don't appear. The shortlist is a shortlist, not a limit:
  **Custom…** in settings still takes any model id the provider accepts, and for
  LM Studio the list is whatever your local server says it is actually serving.

  Deckle also stops offering extended thinking on models that don't support it,
  instead of letting a stored preference turn every message into an error.

- **Queued jobs carry their own model.** Pick one when you queue a job and it is
  pinned there: the list shows what ran each job, a re-run goes to the same
  model, and a job that stopped can be pointed at a bigger model before you
  resume it. Previously every run read whichever model the settings held at the
  moment each turn fired, so changing your model silently changed work that was
  already waiting.

- **The assistant's settings follow you between devices.** Sign in to a
  password-protected server library on a phone, a second laptop, a borrowed
  machine, and the assistant is already configured — provider, model, custom
  instructions and API key. The first device to save hands the server what it
  already had, so nothing is lost on the way in, and the LM Studio URL stays
  behind on each machine, since `localhost` means something different on each
  one. Signing out of the library forgets what it lent that browser.

  The key is kept outside the library (`DECKLE_STATE_DIR`, mode `0600`) and
  served only to a request carrying a valid session, so it cannot leave in an
  export, through the API, or via the assistant's own file-reading tools. A
  server with no `DECKLE_PASSWORD` refuses to hold one at all and says why —
  open to the port is open to the key.

- **A background job says what it is doing.** Each step as it happens —
  *Thinking…*, *Reading Weekly review.md*, *Writing Assistant inbox/Poem.md* —
  instead of a spinner and a title for two minutes. Finished runs list the notes
  they produced as buttons: click one to open it, rather than opening the run to
  find out what it made. A run that stops without finishing raises a toast,
  since the panel is often closed by then.

### Changed

- **The assistant queue moved into the assistant.** It used to be a third tab
  beside Tasks and Bookmarks, which made background work look like a different
  feature from the assistant you were already talking to. It isn't — one is
  answered now and the other later.

  So the panel has two tabs, **Chat** and **Queue**, sharing one composer with
  two buttons: *Send* answers in the conversation, *Queue* (`Cmd/Ctrl ⏎`) hands
  the same words to the background. The Queue tab carries a live count, shows
  the list in full — Needs you, Working, Waiting its turn, Didn't finish,
  Finished — and says so when it is empty. While you are chatting, one line
  above the composer says what the background is doing. A run parked on a
  question badges the assistant's toolbar button, so it stays visible with
  everything closed. The old tab is gone; *Assistant queue* in the command
  palette opens the assistant on the Queue tab.

### Fixed

- **The queue did not work at all on a local or in-browser library.** Its index
  is stored at `.deckle/runs/index.json`, and the helper that reads and writes
  Deckle's own data files passed that whole string to `getFileHandle`, which
  takes a *name*, not a path — so the File System Access API rejected it with
  "Name is not allowed". Every index write threw and every index read quietly
  returned nothing, which is why queued jobs refused to start, vanished on
  reload, and left runs stuck showing "Working". A server library resolves paths
  by URL and never hit it.

  Nested paths now walk their directories, and a queue whose index is missing is
  rebuilt from the run records themselves — so jobs written while the index
  could not be saved come back rather than being lost.

- **Queued jobs could sit at "Waiting its turn" for ever.** Starting a run read
  its record and wrote it back before any of that was wrapped in error handling.
  One refused write — a permission that lapsed on reload, a server that blinked,
  a full disk — and the failure escaped as an unhandled rejection *while the run
  still held its slot in the scheduler*. Every later pass then saw the job as
  already executing and skipped it, so it sat untouched for the rest of the
  session with nothing in the interface and nothing in the console to say why.

  A run's slot is now released on every path out, a job that fails to start
  stays queued instead of being recorded as a run that failed, and the app says
  so rather than failing mutely. The scheduler also runs on a timer as well as
  on a render, so a job that couldn't start a moment ago is tried again when the
  library recovers.

- **A new note could open under the last note's name.** Making a note while the
  one you were reading still had its invented name — and a heading to take a
  real name from — set two things going at once: the rename of the old file and
  the creation of the new one. The rename frees `Untitled.md` the moment it
  moves the file, the new note is handed that very name, and the rename then
  finishes by pointing the tab, the pane and any unsaved edits at where *it*
  ended up. The new note vanished behind the old one. Library changes now happen
  one at a time, so a name is never reissued while a rename is still settling.

- **The thinking toggle appears on OpenRouter.** It was only ever shown for
  Claude and LM Studio, because those were the only two whose request it
  changed — so switching to OpenRouter made the button disappear. OpenRouter's
  unified `reasoning` parameter is now sent when the toggle is on, and the
  reasoning that comes back was already being rendered as *Thought process*. It
  stays hidden for OpenAI, whose `reasoning_effort` is accepted only by its
  reasoning models and is an error on the rest.

## [1.3.0] — 2026-08-13

### Added

- **A queue for the assistant.** Give it a job and it works in the background
  while you carry on writing: *Assistant queue* in the command palette, or the
  third tab beside Tasks and Bookmarks. Runs execute one at a time by default,
  or up to four at once if you'd rather several went in parallel.

  Every run writes into an **Assistant inbox** folder, which is the safety
  boundary: inside it the assistant works freely, and anything outside stops the
  run and shows you the same diff the chat panel would. Deleting always stops,
  wherever it is. A run that genuinely can't proceed can ask you a question and
  park until you answer it.

  The queue makes it plain which runs need you — a badge on the tab counts only
  those, because "three things are running" is not something you have to act on.
  Finished runs list the notes they wrote, and any run can be resumed (carrying
  on with what it had already done) or run again from scratch. A run interrupted
  by closing the tab says so, and offers to carry on.

  Runs are stored in your library under `.deckle/runs/`, so they survive a
  reload and travel with your notes.

## [1.2.0] — 2026-08-13

### Added

- **Assistant memory.** The assistant can now remember what it learns about how
  you work — kept as ordinary Markdown files in `.deckle/memory/` inside your
  library, so it syncs, backs up and exports with your notes, and opens in any
  editor. Read, edit, pin and delete any of it from **Assistant memory** in the
  command palette; turn the whole thing off in the assistant's settings.

  Only a one-line index goes into every message. Bodies are fetched when they
  are relevant to what you asked, within a token budget, so a large memory does
  not quietly become a large bill. Recording something it already knows updates
  the existing memory instead of adding a near-duplicate.

  Memory writes are the one kind of write the assistant makes without asking:
  they touch no note, and the panel is the receipt.

## [1.1.0] — 2026-08-13

### Added

- **An About box.** The version was only in the keyboard sheet, which is no help
  unless you already know the shortcut. *About Deckle* — in the editor menu and
  the command palette — names the version, the library you have open, and which
  of the three backends is holding it, with links to this changelog and the
  source.

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

[Unreleased]: https://github.com/authorTom/deckle/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/authorTom/deckle/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/authorTom/deckle/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/authorTom/deckle/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/authorTom/deckle/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/authorTom/deckle/releases/tag/v1.0.0
