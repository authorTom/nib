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
  just Markdown on disk.
- **Folder tree** — browse nested subfolders, create folders, and **drag-and-drop**
  notes between them.
- **Command palette** — `Ctrl`/`Cmd`+`K` opens a fast, fully keyboard-driven palette
  for commands, formatting, and jumping to any note.
- **Search across the vault** — find notes by title, path, or file contents.
- **Recycle bin** — deleted notes move to a hidden `.trash` folder and can be
  restored or permanently removed.
- **AI assistant** — an optional right-side chat panel that can read your whole
  vault and create/edit/move/delete notes and folders. Every change is shown as
  a diff and must be approved before it runs. Toggle Claude/LM Studio "thinking"
  on/off and add custom instructions. Works with an OpenAI or Anthropic API key,
  or fully locally via [LM Studio](https://lmstudio.ai). API keys are stored only
  in your browser.
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

Nib stores notes directly on disk using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API),
which is available in **Chromium-based desktop browsers** (Chrome, Edge, Brave,
Opera). Firefox, Safari, and mobile browsers are not supported and will show a
notice.

## Getting started

```bash
npm install
npm run dev      # start dev server (http://localhost:5173)
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```

On first run, click **Open folder** and choose a folder to use as your vault.
Nib remembers it for next time (you may be asked to re-grant access on return).

## Tech stack

React · TypeScript · Vite · TipTap + tiptap-markdown (editor) · lucide-react (icons).
The File System Access API is the source of truth for notes; a tiny IndexedDB store
only remembers your chosen folder.

## Project structure

```
src/
  App.tsx                  # Layout, vault gate, theme, focus mode, command palette
  fs/
    vault.ts               # File System Access vault: tree, read/write/move/rename
    fs-access.d.ts         # Permission API type augmentation
  db/notes.ts              # IndexedDB store for the chosen folder handle
  hooks/
    useTheme.ts            # Light/dark, persisted + system default
    useNotes.ts            # Tree, active note, autosave, move, search
  components/
    Sidebar.tsx            # Folder tree, drag-and-drop, search
    Editor.tsx             # Editor workspace: TipTap + TopBar + Toolbar + BubbleMenu
    TopBar.tsx             # Title, actions, command-palette launcher
    Toolbar.tsx            # Quick-format buttons
    CommandPalette.tsx     # Keyboard-driven command + note search palette
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
| `Esc` | Exit focus mode / close the palette |

## License

[MIT](LICENSE)
