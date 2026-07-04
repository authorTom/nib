# Nib

A clean, minimalist, web-based markdown note-taking & word-processing app. Live
WYSIWYG editing, a keyboard-driven command palette, light/dark mode, fully
responsive — and **100% local**: your notes live as plain Markdown files in a
folder on your computer, Obsidian-style. No account, no server, no lock-in.

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
| `Ctrl`/`Cmd` + `Shift` + `F` | Toggle focus mode |
| `Esc` | Close the topmost dialog / exit focus mode |

## License

[MIT](LICENSE)
