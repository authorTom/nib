# Nib

A clean, minimalist, web-based **knowledge management platform**: Markdown
notes with live WYSIWYG editing, a Todoist-style task planner, bookmarks with
collections and comments, and an AI assistant that can search and edit your
knowledge base — plus a keyboard-driven command palette, light/dark mode, and a
fully responsive layout. And it's **100% local**: everything lives as plain
files in a folder on your computer, Obsidian-style. No account, no server, no
lock-in.

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
  storage — see [Browser support](#browser-support).)
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

## Browser support

Nib has two storage backends behind the same vault interface:

- **Chromium desktop browsers** (Chrome, Edge, Brave, Opera) use the
  [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API):
  you pick a real folder on disk and your notes are ordinary files you can open
  in other apps, sync, or back up.
- **Safari and Firefox** fall back to the
  [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system):
  notes are still real `.md` files, but they live in private browser storage on
  your device — not in a folder you can browse — because those browsers don't
  implement the folder picker.

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
private in-browser vault.

To use the AI assistant, open the panel (sparkles icon) → settings (gear) and
pick a provider: Anthropic (Claude), OpenAI, OpenRouter, or a local LM Studio
server. Keys are kept in `localStorage` and sent only to the provider you chose.

## Docker

Nib ships as a small production container: a multi-stage build compiles the app
with Node, then [nginx-unprivileged](https://github.com/nginxinc/docker-nginx-unprivileged)
(Alpine, non-root, port **8080**) serves the static files with gzip, immutable
caching for hashed assets, security headers, and a built-in health check.

### Run the published image

Every push to `main` publishes a multi-arch (amd64 + arm64) image to GitHub
Container Registry via the included workflow:

```bash
docker run -d --name nib -p 8080:8080 --restart unless-stopped \
  ghcr.io/authortom/nib:latest
# → http://localhost:8080
```

### Build and run locally

```bash
docker build -t nib .
docker run -d -p 8080:8080 nib

# or with compose:
docker compose up -d          # production build at http://localhost:8080
```

### Test environment

The compose file includes a containerised dev server (hot reload, no local
Node install needed):

```bash
docker compose --profile dev up dev   # → http://localhost:5173
```

> **HTTPS matters in production.** The File System Access API and OPFS require
> a secure context — `http://localhost` is fine for local use, but anything
> served from another host must sit behind TLS (e.g. Caddy, Traefik, or nginx
> with certificates), or the vault features won't be available.

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
The vault on disk (or OPFS) is the source of truth for notes; IndexedDB only
remembers your chosen folder and caches search embeddings.

## Project structure

```
src/
  App.tsx                  # Layout, vault gate, theme, focus mode, modals, palette
  fs/
    vault.ts               # Vault: tree, read/write/move/rename, trash (disk + OPFS)
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
    useNotes.ts            # Tree, active note, autosave, move, search, history
  components/
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
