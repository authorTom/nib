import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileDown,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Maximize2,
  Minimize2,
  Moon,
  Plus,
  Sun,
  Trash2,
} from 'lucide-react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import CommandPalette, { type Command } from './components/CommandPalette'
import TrashModal from './components/TrashModal'
import {
  formatActions,
  headingActions,
  listActions,
} from './components/formatActions'
import { exportToPdf } from './lib/exportPdf'
import { useTheme } from './hooks/useTheme'
import { useNotes } from './hooks/useNotes'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const {
    status,
    vaultName,
    tree,
    notes,
    activeNote,
    activeId,
    activeContent,
    setActiveId,
    connect,
    reconnect,
    createNote,
    createFolder,
    moveNote,
    deleteNote,
    saveContent,
    renameActive,
    trashItems,
    loadTrash,
    restoreFromTrash,
    deleteFromTrash,
    emptyTrash,
    query,
    setQuery,
    searchResults,
  } = useNotes()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  const [focusMode, setFocusMode] = useState(false)
  const toggleFocus = useCallback(() => setFocusMode((f) => !f), [])

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [editor, setEditor] = useState<TiptapEditor | null>(null)

  const [trashOpen, setTrashOpen] = useState(false)
  const openTrash = useCallback(async () => {
    await loadTrash()
    setTrashOpen(true)
  }, [loadTrash])

  // Keyboard shortcuts: Ctrl/Cmd+K opens the palette,
  // Ctrl/Cmd+Shift+F toggles focus, Escape exits focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 'f'
      ) {
        e.preventDefault()
        toggleFocus()
      } else if (e.key === 'Escape') {
        setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFocus])

  const handleSelect = useCallback(
    (id: string) => {
      setActiveId(id)
      closeSidebar()
    },
    [setActiveId, closeSidebar],
  )

  // Deleting moves the note to the recycle bin (recoverable), so no confirm.
  const handleDelete = useCallback(
    (id: string) => {
      void deleteNote(id)
    },
    [deleteNote],
  )

  const handleCreateFolder = useCallback(
    async (parentPath: string) => {
      const name = window.prompt('New folder name', 'New Folder')
      if (!name) return undefined
      return await createFolder(parentPath, name)
    },
    [createFolder],
  )

  // ---- Command palette actions ----
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'new-note',
        label: 'New note',
        icon: Plus,
        keywords: 'create add file',
        run: () => void createNote(),
      },
      {
        id: 'new-folder',
        label: 'New folder',
        icon: FolderPlus,
        keywords: 'create directory',
        run: () => void handleCreateFolder(''),
      },
      {
        id: 'focus',
        label: 'Toggle focus mode',
        icon: Maximize2,
        hint: 'Ctrl/Cmd+Shift+F',
        keywords: 'zen distraction free writing',
        run: toggleFocus,
      },
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: 'theme appearance dark light',
        run: toggleTheme,
      },
      {
        id: 'open-folder',
        label: 'Open a different folder',
        icon: FolderOpen,
        keywords: 'vault switch change',
        run: () => void connect(),
      },
      {
        id: 'open-trash',
        label: 'Open Recycle Bin',
        icon: Trash2,
        keywords: 'trash deleted bin restore',
        run: () => void openTrash(),
      },
    ]
    if (activeNote) {
      list.push({
        id: 'export-pdf',
        label: 'Export current note to PDF',
        icon: FileDown,
        keywords: 'print save pdf',
        run: () => exportToPdf(activeNote.title),
      })
      list.push({
        id: 'delete-note',
        label: 'Move current note to Recycle Bin',
        icon: Trash2,
        keywords: 'remove trash delete bin',
        run: () => handleDelete(activeNote.id),
      })
    }

    // Formatting commands act on the live editor (only when one is mounted).
    if (editor) {
      for (const action of [...headingActions, ...formatActions, ...listActions]) {
        list.push({
          id: `fmt-${action.name}`,
          label: action.label,
          icon: action.Icon,
          section: 'Formatting',
          keywords: 'format style text',
          run: () => action.run(editor),
        })
      }
    }

    return list
  }, [
    createNote,
    handleCreateFolder,
    toggleFocus,
    theme,
    toggleTheme,
    connect,
    openTrash,
    activeNote,
    handleDelete,
    editor,
  ])

  // ---- Vault gate: shown until a folder is connected ----
  if (status !== 'ready') {
    return (
      <div className="app">
        <div className="main">
          <button
            type="button"
            className="icon-btn gate-theme"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <div className="empty-state">
            <img className="brand-mark" src="/nib.svg" alt="" width={44} height={44} />
            <div className="brand">Nib</div>
            {status === 'loading' && <p>Loading…</p>}

            {status === 'unsupported' && (
              <>
                <h2>Browser not supported</h2>
                <p>
                  This app stores notes as files in a folder on your computer,
                  which needs a Chromium-based browser (Chrome, Edge, Brave, or
                  Opera) on desktop.
                </p>
              </>
            )}

            {status === 'no-vault' && (
              <>
                <FolderOpen size={40} />
                <h2>Choose a notes folder</h2>
                <p>
                  Pick a folder to use as your vault. Your notes are saved there
                  as plain Markdown (.md) files — open them in Obsidian, sync
                  them, or back them up however you like.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void connect()}
                >
                  <FolderOpen size={18} />
                  Open folder
                </button>
              </>
            )}

            {status === 'needs-permission' && (
              <>
                <FolderOpen size={40} />
                <h2>Reconnect your vault</h2>
                <p>
                  Grant access to{' '}
                  <strong>{vaultName ?? 'your folder'}</strong> to continue.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void reconnect()}
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void connect()}
                >
                  Choose a different folder
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ---- Ready: full app ----
  return (
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      <Sidebar
        tree={tree}
        activeId={activeId}
        open={sidebarOpen}
        vaultName={vaultName}
        query={query}
        searchResults={searchResults}
        onQueryChange={setQuery}
        onSelect={handleSelect}
        onCreate={() => {
          void createNote()
          closeSidebar()
        }}
        onCreateInFolder={(folderPath) => void createNote(folderPath)}
        onCreateFolder={handleCreateFolder}
        onMoveNote={(id, target) => void moveNote(id, target)}
        onDelete={handleDelete}
        onSwitchVault={() => void connect()}
        onOpenTrash={() => void openTrash()}
      />

      <div
        className={`scrim${sidebarOpen ? ' show' : ''}`}
        onClick={closeSidebar}
      />

      {activeNote && activeContent !== null ? (
        <Editor
          key={activeNote.id}
          title={activeNote.title}
          content={activeContent}
          onContentChange={saveContent}
          onTitleCommit={(title) => void renameActive(title)}
          onNew={() => void createNote()}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onToggleFocus={toggleFocus}
          onOpenPalette={() => setPaletteOpen(true)}
          onEditorReady={setEditor}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      ) : (
        <div className="main">
          <div className="empty-state">
            {activeNote ? (
              <p>Loading…</p>
            ) : (
              <>
                <h2>No note selected</h2>
                <p>Create a note to start writing.</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void createNote()}
                >
                  <FilePlus size={18} />
                  New note
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {focusMode && (
        <button
          type="button"
          className="icon-btn focus-exit"
          onClick={toggleFocus}
          title="Exit focus mode (Esc)"
          aria-label="Exit focus mode"
        >
          <Minimize2 size={18} />
        </button>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        notes={notes}
        onOpenNote={handleSelect}
      />

      <TrashModal
        open={trashOpen}
        items={trashItems}
        onClose={() => setTrashOpen(false)}
        onRestore={(name) => void restoreFromTrash(name)}
        onDeleteForever={(name) => void deleteFromTrash(name)}
        onEmpty={() => void emptyTrash()}
      />
    </div>
  )
}
