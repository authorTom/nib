# Nib

A clean, minimalist, web-based **knowledge management platform**: Markdown
notes with live WYSIWYG editing, a Todoist-style task planner, bookmarks with
collections and comments, and an AI assistant that can search and edit your
knowledge base — plus a keyboard-driven command palette, light/dark mode, and a
fully responsive layout.

Everything lives as plain Markdown files, and you choose where: a folder on your
computer, Obsidian-style, or — if you self-host with Docker — a volume on your
own server, which makes Nib fully web based and leaves nothing on the device
you're using. No third-party account, no lock-in.

![Nib — Markdown notes with a folder tree, live WYSIWYG editing, and a command palette](docs/screenshots/editor.png)

| Task planner — Inbox, Today, Upcoming with a mini calendar | Bookmarks — collections and per-bookmark comments |
| --- | --- |
| ![Todoist-style task planner with due dates, priorities, and a month calendar](docs/screenshots/tasks.png) | ![Bookmarks with colored collections and a comment box](docs/screenshots/bookmarks.png) |
| **AI assistant — search and edit your vault (dark mode)** | **Command palette — everything a keystroke away** |
| ![AI assistant panel in dark mode](docs/screenshots/assistant.png) | ![Command palette in dark mode](docs/screenshots/palette.png) |

## Features

- **Live WYSIWYG markdown** — type markdown (`# `, `**bold**`, `- list`) and it
  renders inline as you go (powered by TipTap / ProseMirror).
- **Local folder vault** — pick a folder and Nib reads/writes your notes there as
  real `.md` files. Open the same folder in Obsidian, sync it, or back it up — it's
  just Markdown on disk. (Chromium browsers; Safari/Firefox use private in-browser
  storage — see [Where your notes are stored](#where-your-notes-are-stored).)
- **Or a server vault** — self-host with Docker and your notes can live in a
  volume on your own server instead, password protected, reachable from any
  browser or device with nothing stored locally. See
  [Server vault](#server-vault-fully-web-based).
- **Folder tree** — browse nested subfolders, create folders, and **drag-and-drop**
  notes between them.
- **Command palette** — `Ctrl`/`Cmd`+`K` opens a fast, fully keyboard-driven palette
  for commands, formatting, and jumping to any note.
- **Search across the vault** — find notes by title, path, or file contents.
- **Tasks & planner** — a Todoist-style panel docked on the left: Inbox, Today,
  Upcoming (agenda + mini month calendar), projects, priorities (P1–P4),
  recurring tasks, a completed log, and a bin for deleted tasks (restorable,
  auto-purged after 30 days). Highlight text in a note and press
  `Ctrl`/`Cmd`+`Shift`+`A` (or use the selection menu) to capture it as a task
  that links back to the note. Tasks are stored in a hidden `.nib/tasks.json`
  inside your vault, so they sync and back up with your notes.
- **Bookmarks** — a Bookmarks tab in the same left panel: save URLs, pages, and
  products into colored collections, each with its own comment box (why you
  saved it, prices, thoughts). Paste a link to add it, or select a link in a
  note and use the bookmark button in the selection menu — captured bookmarks
  link back to their source note. Stored in `.nib/bookmarks.json` in the vault.
- **Version history** — restore points are saved automatically: before every AI
  edit, periodically while you type, and before every restore. Open the clock
  icon to preview, restore, or delete a note's earlier versions (kept in a
  hidden `.history` folder, 20 per note).
- **Recycle bin** — deleted notes move to a hidden `.trash` folder and can be
  restored or permanently removed.
- **AI assistant** — an optional right-side chat panel that can search and read
  your whole vault and create/edit/move/delete notes and folders. Every change
  is shown as a diff and must be approved before it runs. Ask questions about
  your notes and it finds and cites the relevant ones. Works with an Anthropic,
  OpenAI, or [OpenRouter](https://openrouter.ai) API key, or fully locally via
  [LM Studio](https://lmstudio.ai). Reasoning models show a collapsible
  "Thought process"; API keys are stored only in your browser.
- **Semantic vault search (optional)** — enable embeddings in the assistant
  settings (OpenAI or a local LM Studio embedding model) and vault search
  matches by meaning, not just keywords. Vectors are cached locally and only
  changed notes are re-embedded; keyword (BM25) search always works without it.
- **Inline Ask AI** — highlight text and click the brain icon in the selection
  menu to improve, fix, shorten, summarize, explain, or run a custom prompt on
  just that passage, then Replace / Insert / Copy the result.
- **Quick formatting** — toolbar + floating selection menu for bold, italic,
  strikethrough, inline code, headings (H1–H3), bulleted / numbered lists, quotes.
- **Focus mode** — hide all chrome for distraction-free writing
  (`Ctrl`/`Cmd`+`Shift`+`F`, or `Esc` to exit).
- **Light & dark mode** — defaults to your system preference; choice persists.
- **Responsive** — desktop, tablet, and mobile (collapsible note drawer).
- **Export** — download a note as `.md`, or export to PDF via a clean print layout.

## Where your notes are stored

Nib has three storage backends behind the same vault interface. Whichever you
use, your notes are ordinary `.md` files in an identical folder layout — so a
vault copied from a disk folder into the server's volume (or the other way
round) just works. Only the in-browser vault is awkward to copy, since it lives
in browser-managed storage rather than a folder you can open.

- **A folder on your computer** — **Chromium desktop browsers** (Chrome, Edge,
  Brave, Opera) use the
  [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API):
  you pick a real folder on disk and your notes are ordinary files you can open
  in other apps, sync, or back up.
- **Privately in your browser** — **Safari and Firefox** fall back to the
  [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system):
  notes are still real `.md` files, but they live in private browser storage on
  your device — not in a folder you can browse — because those browsers don't
  implement the folder picker.
- **On your own server** — when you [self-host with Docker](#server-vault-fully-web-based),
  notes are stored in a volume on the machine running Nib. The app then works
  from any browser, including Safari and mobile, and nothing is kept on the
  device you're using. See [Server vault](#server-vault-fully-web-based).

When a server vault is available, Nib asks which you want on first load; you can
switch later from the command palette (`Ctrl`/`Cmd`+`K`). Nothing is copied
between backends automatically.

## Getting started

```bash
npm install
npm run dev      # start dev server (http://localhost:5173)
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```

On first run in a Chromium browser, click **Open folder** and choose a folder to
use as your vault — Nib remembers it for next time (you may be asked to re-grant
access on return). In Safari/Firefox, click **Get started** to create the
private in-browser vault. If you're running a Docker deployment with the
[server vault](#server-vault-fully-web-based) enabled, you'll be asked which of
the two you want instead.

To use the AI assistant, open the panel (sparkles icon) → settings (gear) and
pick a provider: Anthropic (Claude), OpenAI, OpenRouter, or a local LM Studio
server. Keys are kept in `localStorage` and sent only to the provider you chose.

## Docker

Nib ships as a small production container: a multi-stage build compiles the app
with Node, then a dependency-free Node server (Alpine, non-root, port **8080**)
serves the static files with gzip, immutable caching for hashed assets, security
headers, and a built-in health check.

That same server can also hold your notes — the
[server vault](#server-vault-fully-web-based). Two different defaults are worth
keeping straight:

- **The image** ships with the server vault **off** (`NIB_SERVER_VAULT` unset),
  so `docker run` with no arguments behaves exactly as earlier versions did: a
  static file server, notes on your device.
- **The bundled `compose.yaml` turns it on** and mounts a volume for it, because
  that's the setup most people deploying Nib to a server actually want.

Either way the app still offers the local backends, and you pick on first load.

### Deploy with Compose (recommended)

Every push to `main` publishes a multi-arch (amd64 + arm64) image to GitHub
Container Registry via the included workflow, so deploying is just: grab the
compose file and bring it up — no source checkout, no local build.

```bash
# On the server, in an empty deploy directory:
curl -O https://raw.githubusercontent.com/authorTom/nib/main/compose.yaml
docker compose up -d          # pulls ghcr.io/authortom/nib:latest
# → http://localhost:8080
```

`compose.yaml` pulls the prebuilt image by default — no `build:` needed — which
is what tools like Dockge and Portainer expect. To change the host port or pin
a specific image tag, drop a `.env` next to `compose.yaml` (Compose reads it
automatically):

```bash
curl -O https://raw.githubusercontent.com/authorTom/nib/main/.env.example
mv .env.example .env          # then edit NIB_PORT / NIB_IMAGE / NIB_PASSWORD
```

Because the bundled `compose.yaml` enables the server vault, read the next
section before putting this anywhere reachable — it starts with no password
unless you set one.

### Server vault (fully web based)

The server vault stores your notes in the container as ordinary `.md` files in a
Docker volume, instead of on the device you're using — so you can open Nib from
a laptop, a phone, or Safari and get the same notes, with nothing kept locally.

`compose.yaml` already enables it. **Set a password before exposing it**:

```bash
# in .env, next to compose.yaml
NIB_SERVER_VAULT=true                           # already the compose default
NIB_PASSWORD=a-long-passphrase                  # blank = no password at all
NIB_SESSION_SECRET=$(openssl rand -base64 32)   # keeps sign-ins across restarts
```

```bash
docker compose up -d          # → http://localhost:8080
```

On first load Nib asks where notes should live; pick **On this server** and enter
the password. To switch away later, open the command palette (`Ctrl`/`Cmd`+`K`)
→ *Sign out of the server vault* (or *Leave the server vault* when no password
is set). The same palette entry reads *Switch to the server vault* when you're
using a local one.

| Variable | Default | What it does |
| --- | --- | --- |
| `NIB_SERVER_VAULT` | *(off)* | `true` enables the server vault |
| `NIB_PASSWORD` | *(none)* | Password for the vault. **Blank means no password at all** |
| `NIB_VAULT_NAME` | `My Notes` | Name shown in the app |
| `NIB_SESSION_SECRET` | *(random)* | Fixed cookie-signing key, so restarts don't sign everyone out |
| `NIB_SESSION_TTL_DAYS` | `30` | How long a sign-in lasts |
| `NIB_VAULT_DIR` | `/data` | Where the notes live inside the container |

Things worth knowing:

- **One vault, one password.** Nib has no user accounts, so everyone who signs
  in shares the same notes.
- **A blank `NIB_PASSWORD` means no protection.** Anyone who can reach the port
  can read and write every note. That's only reasonable behind a VPN, Tailscale,
  or a reverse proxy that authenticates — the server logs a warning at startup
  when it happens.
- **How signing in works.** The password is checked in constant time and
  exchanged for a signed, `HttpOnly`, `SameSite=Strict` session cookie — it isn't
  stored in the browser and isn't sent again after sign-in. Repeated failures
  from one address are throttled (10 per 15 minutes). Sessions last
  `NIB_SESSION_TTL_DAYS`; if one expires while the app is open, Nib returns to
  the unlock screen rather than failing saves silently.
- **Use HTTPS if it's reachable from anywhere but localhost.** The password
  crosses the network once at sign-in, and the session cookie on every request
  after that — both in the clear without TLS. The cookie is marked `Secure`
  automatically when the request arrives over HTTPS.
- **Your notes are just files.** Back the volume up with:

  ```bash
  docker run --rm -v nib-vault:/data -v "$PWD:/out" \
    alpine tar czf /out/nib-backup.tar.gz -C /data .
  ```

  That includes the hidden `.nib` (tasks, bookmarks), `.history` and `.trash`
  folders, so it's a complete vault. Or mount a host directory instead of the
  named volume (`./notes:/data`, which must be writable by uid 1000) and point
  Obsidian or your existing backup tool straight at it.
- **AI keys stay in your browser.** The server never sees them and never proxies
  AI requests.

### Run the published image directly

Prefer `docker run`? Same image, no compose file:

```bash
# Static app only — notes stay on your device (the previous behaviour):
docker run -d --name nib -p 8080:8080 --restart unless-stopped \
  ghcr.io/authortom/nib:latest

# With a server vault:
docker run -d --name nib -p 8080:8080 --restart unless-stopped \
  -e NIB_SERVER_VAULT=true -e NIB_PASSWORD=a-long-passphrase \
  -v nib-vault:/data \
  ghcr.io/authortom/nib:latest
# → http://localhost:8080
```

### Build from source instead of pulling

To build the image yourself rather than pull it, uncomment the `build:` block
in `compose.yaml` and run with `--build` (requires a full repo checkout):

```bash
docker compose up -d --build   # builds locally, serves at http://localhost:8080

# or without compose:
docker build -t nib .
docker run -d -p 8080:8080 nib
```

### Test environment

`compose.yaml` also includes a containerised dev server (hot reload, no local
Node install needed; run from a source checkout):

```bash
docker compose --profile dev up dev   # → http://localhost:5173
```

That profile runs Vite alone, so the server vault isn't reachable from it and
Nib offers only the local backends. To develop against the server vault with hot
reload, run the API server next to Vite instead — `npm run dev` proxies `/api`
to `http://127.0.0.1:8080` (override with `NIB_API_TARGET`):

```bash
NIB_SERVER_VAULT=true NIB_VAULT_DIR=./vault node server/index.mjs &
npm run dev                           # → http://localhost:5173
```

> **HTTPS matters in production.** The File System Access API and OPFS require
> a secure context — `http://localhost` is fine for local use, but anything
> served from another host must sit behind TLS (e.g. Caddy, Traefik, or nginx
> with certificates), or the local vault features won't be available. The server
> vault works without a secure context, but sends your password and session
> cookie in the clear, so it needs TLS just as much.

### Where to store the image

**Recommended: GitHub Container Registry (GHCR)** — the repo already lives on
GitHub, so images stay next to the code, the included workflow authenticates
with the built-in `GITHUB_TOKEN` (no extra secrets to manage), and it's free
for public images. The first published package is private by default — flip it
to public (or grant access) under the package's settings on GitHub.

Alternatives: **Docker Hub** (most familiar `docker pull` experience, but rate
limits and a separate access token to manage) or a cloud registry
(ECR/GCR/ACR) if you deploy into that cloud anyway.

### Updating when you push new commits

Publishing is already automated: `.github/workflows/docker.yml` rebuilds and
pushes on every push to `main`, tagging `latest` and `sha-<commit>`; pushing a
git tag like `v1.0.0` also publishes a `1.0.0` tag.

On the machine running the container, updating is a pull away:

```bash
docker compose pull && docker compose up -d   # or: docker pull … && docker restart
```

Two good ways to make that automatic:

- **[Watchtower](https://containrrr.dev/watchtower/)** — runs alongside your
  container and restarts it whenever `:latest` changes. Zero ceremony; best
  for a personal server.
- **Pinned tags + explicit deploys** — in production, reference an immutable
  tag (`sha-<commit>` or a `vX.Y.Z` semver tag) instead of `:latest`, and roll
  forward by changing the tag. Predictable and trivially rolled back.

## Tech stack

React · TypeScript · Vite · TipTap + tiptap-markdown (editor) · lucide-react
(icons) · @anthropic-ai/sdk (Claude; OpenAI-compatible providers via `fetch`).

The vault — a folder on disk, OPFS, or the server — is the source of truth for
notes; IndexedDB only remembers your chosen folder and caches search embeddings.
All three backends sit behind the browser's `FileSystemDirectoryHandle`
interface, so the rest of the app doesn't know or care which one is in use: the
server vault is an adapter ([`src/fs/remote.ts`](src/fs/remote.ts)) that
implements that same interface over HTTP.

The container's server ([`server/`](server/)) is plain Node with **no
dependencies** — only built-in modules — so there is nothing to audit or patch
beyond Node itself.

## Project structure

```
server/                    # Container runtime (Node built-ins only, no deps)
  index.mjs                # HTTP entry: routing, config, graceful shutdown
  vault-api.mjs            # Server vault file API (tree/read/write/mkdir/delete)
  auth.mjs                 # Optional password gate + signed session cookies
  paths.mjs                # Vault path validation (traversal + symlink escapes)
  static.mjs               # Serves the built SPA: caching, gzip, security headers

src/
  App.tsx                  # Layout, theme, focus mode, modals, command palette
  fs/
    vault.ts               # Vault: tree, read/write/move/rename, trash (all backends)
    remote.ts              # Server vault: the same handle interface over HTTP
    history.ts             # Version history snapshots (.history folder)
    fs-access.d.ts         # Permission API type augmentation
  db/notes.ts              # IndexedDB store for the chosen folder handle
  ai/
    useAssistant.ts        # Chat loop, tool approval gate, system prompt
    providers.ts           # Anthropic / OpenAI / OpenRouter / LM Studio backends
    tools.ts               # Vault tools the model can call (+ approval previews)
    retrieval.ts           # search_notes: BM25 + optional embeddings (RRF-fused)
    settings.ts, types.ts  # Assistant settings persistence and shared types
  tasks/
    useTasks.ts            # Task state + persistence (vault .nib/tasks.json)
    dates.ts, types.ts     # Date/recurrence helpers and task types
    store.ts               # Load/save the task store
  bookmarks/
    useBookmarks.ts        # Bookmark state + persistence (.nib/bookmarks.json)
    url.ts, types.ts       # URL normalization/extraction and bookmark types
    store.ts               # Load/save the bookmark store
  hooks/
    useTheme.ts            # Light/dark, persisted + system default
    useNotes.ts            # Tree, active note, autosave, move, search, history,
                           #   and which storage backend is in use
  components/
    VaultGate.tsx          # First-run screen: pick a backend, unlock the server vault
    Sidebar.tsx            # Folder tree, drag-and-drop, search
    Editor.tsx             # Editor workspace: TipTap + TopBar + Toolbar + BubbleMenu
    TopBar.tsx             # Title, actions, command-palette launcher
    Toolbar.tsx            # Quick-format buttons
    CommandPalette.tsx     # Keyboard-driven command + note search palette
    AssistantPanel.tsx     # AI chat panel, settings, approval cards
    TaskPanel.tsx          # Left panel: Tasks | Bookmarks tabs
    BookmarkList.tsx       # Bookmarks: collections, comments, quick-add
    TaskItem.tsx           # Task row + inline editor
    MiniCalendar.tsx       # Month grid for the Upcoming view
    InlineAssistant.tsx    # "Ask AI" popover on a text selection
    HistoryModal.tsx       # Version history: preview / restore / delete
    TrashModal.tsx         # Recycle bin
    formatActions.tsx      # Shared formatting command definitions
  lib/
    exportMarkdown.ts      # .md download
    exportPdf.ts           # print-to-PDF
  styles/                  # theme / global / editor / print CSS
```

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `K` | Open the command palette |
| `Ctrl`/`Cmd` + `Shift` + `A` | Capture selection as a task / toggle the task panel |
| `Ctrl`/`Cmd` + `Shift` + `F` | Toggle focus mode |
| `Esc` | Close the topmost dialog / exit focus mode |

## License

[MIT](LICENSE)
