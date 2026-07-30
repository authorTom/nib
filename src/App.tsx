import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  FileDown,
  FilePlus,
  FolderOpen,
  FolderPlus,
  History,
  ListTodo,
  Maximize2,
  Minimize2,
  Moon,
  Package,
  Plus,
  Server,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import CommandPalette, { type Command } from './components/CommandPalette'
import TrashModal from './components/TrashModal'
import ExportModal from './components/ExportModal'
import HistoryModal from './components/HistoryModal'
import AssistantPanel from './components/AssistantPanel'
import TaskPanel from './components/TaskPanel'
import VaultGate from './components/VaultGate'
import { useAssistant } from './ai/useAssistant'
import { useTasks } from './tasks/useTasks'
import { useBookmarks } from './bookmarks/useBookmarks'
import { domainOf, findUrl, normalizeUrl } from './bookmarks/url'
import {
  formatActions,
  headingActions,
  listActions,
} from './components/formatActions'
import { exportToPdf } from './lib/exportPdf'
import {
  selectionFromDataTransfer,
  selectionFromFiles,
  type ImportSelection,
} from './lib/importMarkdown'
import { useTheme } from './hooks/useTheme'
import { useNotes } from './hooks/useNotes'
import { supportsDiskPicker } from './fs/vault'

/** `webkitdirectory` is how every browser exposes folder picking, but it isn't
 *  in React's typed attribute list — assert it once here rather than at each use. */
const DIRECTORY_PROPS = { webkitdirectory: '', directory: '' } as unknown as
  React.InputHTMLAttributes<HTMLInputElement>

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const {
    status,
    vaultName,
    vaultDir,
    reload,
    tree,
    notes,
    activeNote,
    activeId,
    activeContent,
    setActiveId,
    connect,
    reconnect,
    serverVault,
    usingServerVault,
    connectServer,
    loginServer,
    signOutServer,
    createNote,
    createFolder,
    deleteFolder,
    renameFolder,
    moveNote,
    deleteNote,
    saveContent,
    renameActive,
    importNotes,
    trashItems,
    loadTrash,
    restoreFromTrash,
    deleteFromTrash,
    emptyTrash,
    historyItems,
    loadHistory,
    previewVersion,
    restoreVersion,
    deleteVersion,
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

  const [historyOpen, setHistoryOpen] = useState(false)
  const openHistory = useCallback(async () => {
    await loadHistory()
    setHistoryOpen(true)
  }, [loadHistory])

  // Tasks & bookmarks share a tabbed panel docked on the left (beside the
  // note list); the assistant stays on the right.
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'tasks' | 'bookmarks'>('tasks')
  const toggleAssistant = useCallback(() => setAssistantOpen((o) => !o), [])
  /** Open the panel on a tab; clicking the active tab's button closes it. */
  const openPanelTab = useCallback(
    (which: 'tasks' | 'bookmarks') => {
      if (tasksOpen && panelTab === which) {
        setTasksOpen(false)
        return
      }
      setPanelTab(which)
      setTasksOpen(true)
    },
    [tasksOpen, panelTab],
  )
  const toggleTasks = useCallback(() => openPanelTab('tasks'), [openPanelTab])
  const toggleBookmarks = useCallback(
    () => openPanelTab('bookmarks'),
    [openPanelTab],
  )

  // Tasks (Todoist-style planner, stored in the vault's .nib/tasks.json)
  const tasks = useTasks(vaultDir)

  // Bookmarks (stored in the vault's .nib/bookmarks.json)
  const bookmarks = useBookmarks(vaultDir)

  // Transient confirmation toast (e.g. after capturing a task).
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  const addTaskFromText = useCallback(
    (text: string) => {
      const title = text.replace(/\s+/g, ' ').trim().slice(0, 300)
      if (!title) return
      tasks.addTask({
        title,
        source: activeId ? { noteId: activeId } : undefined,
      })
      showToast('Task added to Inbox')
    },
    [tasks, activeId, showToast],
  )

  /** Capture the editor selection as a task; false if nothing is selected. */
  const captureSelectionTask = useCallback(() => {
    if (!editor) return false
    const { from, to } = editor.state.selection
    if (from === to) return false
    addTaskFromText(editor.state.doc.textBetween(from, to, ' '))
    return true
  }, [editor, addTaskFromText])

  /** Capture the link in the editor selection as a bookmark. */
  const captureSelectionBookmark = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) {
      showToast('Select a link or URL first')
      return
    }
    // Prefer an actual link mark in the selection; fall back to a URL in the text.
    let href: string | null = null
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (href) return false
      const mark = node.marks.find((m) => m.type.name === 'link')
      if (mark) href = (mark.attrs as { href?: string }).href ?? null
      return true
    })
    const text = editor.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim()
    const raw = href ?? findUrl(text)
    const url = raw ? normalizeUrl(raw) : null
    if (!url) {
      showToast('No link found in selection')
      return
    }
    const title =
      text.replace(raw!, '').replace(/\s+/g, ' ').trim().slice(0, 200) || domainOf(url)
    bookmarks.addBookmark({
      url,
      title,
      source: activeId ? { noteId: activeId } : undefined,
    })
    showToast('Bookmark saved')
  }, [editor, bookmarks, activeId, showToast])

  // ---- Import / export ----
  // The file inputs live here rather than in the sidebar so the command palette
  // can open the same pickers.
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const openPicker = useCallback((input: HTMLInputElement | null) => {
    if (!input) return
    // Clear first, so picking the same file twice in a row still fires change.
    input.value = ''
    input.click()
  }, [])

  const openImport = useCallback(() => openPicker(fileInput.current), [openPicker])
  const openFolderImport = useCallback(
    () => openPicker(folderInput.current),
    [openPicker],
  )

  const runImport = useCallback(
    async (selection: ImportSelection, targetFolder: string) => {
      if (!selection.items.length) {
        showToast(
          selection.skipped.length
            ? 'No Markdown files in that selection'
            : 'Nothing to import',
        )
        return
      }
      const imported = await importNotes(selection.items, targetFolder)
      const skipped = selection.skipped.length
      showToast(
        `Imported ${imported.length} note${imported.length === 1 ? '' : 's'}` +
          (skipped ? ` · ${skipped} skipped` : ''),
      )
      closeSidebar()
    },
    [importNotes, showToast, closeSidebar],
  )

  const handleImportFiles = useCallback(
    (files: FileList | File[]) => {
      void (async () => runImport(await selectionFromFiles(files), ''))()
    },
    [runImport],
  )

  // `webkitGetAsEntry` is only valid while the drop event is being dispatched,
  // so selectionFromDataTransfer reads the entries synchronously before its
  // first await — don't defer this call.
  const handleDropFiles = useCallback(
    (transfer: DataTransfer, targetFolder: string) => {
      const pending = selectionFromDataTransfer(transfer)
      void (async () => runImport(await pending, targetFolder))()
    },
    [runImport],
  )

  // AI assistant (right-side panel)
  const getDir = useCallback(() => vaultDir, [vaultDir])
  const onAssistantMutated = useCallback(() => void reload(), [reload])
  const getActivePath = useCallback(() => activeNote?.id ?? null, [activeNote])
  const assistant = useAssistant({
    getDir,
    onMutated: onAssistantMutated,
    getActivePath,
  })

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
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 'a'
      ) {
        // Capture the selection as a task; with no selection, toggle the panel.
        e.preventDefault()
        if (!captureSelectionTask()) toggleTasks()
      } else if (e.key === 'Escape') {
        // Close the topmost layer first; only exit focus mode if nothing is open.
        // (The command palette handles its own Escape and stops propagation.)
        if (historyOpen) setHistoryOpen(false)
        else if (trashOpen) setTrashOpen(false)
        else setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFocus, trashOpen, historyOpen, captureSelectionTask, toggleTasks])

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

  const handleDeleteFolder = useCallback(
    (folderPath: string) => {
      const name = folderPath.includes('/')
        ? folderPath.slice(folderPath.lastIndexOf('/') + 1)
        : folderPath
      if (
        window.confirm(
          `Delete the folder "${name}"? Its notes will be moved to the Recycle Bin.`,
        )
      ) {
        void deleteFolder(folderPath)
      }
    },
    [deleteFolder],
  )

  const handleRenameFolder = useCallback(
    (folderPath: string) => {
      const current = folderPath.includes('/')
        ? folderPath.slice(folderPath.lastIndexOf('/') + 1)
        : folderPath
      const name = window.prompt('Rename folder', current)
      if (!name || name === current) return
      void renameFolder(folderPath, name)
    },
    [renameFolder],
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
        label: supportsDiskPicker()
          ? 'Open a different folder'
          : 'Use the vault in this browser',
        icon: FolderOpen,
        keywords: 'vault switch change local folder',
        run: () => void connect(),
      },
      {
        id: 'open-trash',
        label: 'Open Recycle Bin',
        icon: Trash2,
        keywords: 'trash deleted bin restore',
        run: () => void openTrash(),
      },
      {
        id: 'import-md',
        label: 'Import Markdown files',
        icon: Upload,
        keywords: 'import upload md markdown add files obsidian migrate',
        run: openImport,
      },
      {
        id: 'import-folder',
        label: 'Import a folder of notes',
        icon: FolderOpen,
        keywords: 'import upload folder directory bulk obsidian migrate restore',
        run: openFolderImport,
      },
      {
        id: 'export-zip',
        label: 'Export knowledge base as ZIP',
        icon: Package,
        keywords: 'export download backup zip archive everything vault',
        run: () => setExportOpen(true),
      },
      {
        id: 'toggle-assistant',
        label: 'Toggle AI assistant',
        icon: Sparkles,
        keywords: 'ai assistant chat llm claude openai',
        run: toggleAssistant,
      },
      {
        id: 'toggle-tasks',
        label: 'Toggle tasks',
        icon: ListTodo,
        hint: 'Ctrl/Cmd+Shift+A',
        keywords: 'todo task planner inbox today upcoming calendar',
        run: toggleTasks,
      },
      {
        id: 'toggle-bookmarks',
        label: 'Toggle bookmarks',
        icon: Bookmark,
        keywords: 'bookmark url link page product saved collection',
        run: toggleBookmarks,
      },
    ]

    // Only offered where a server vault actually exists (Docker deployments
    // with a volume mounted).
    if (serverVault) {
      list.push({
        id: 'server-vault',
        label: usingServerVault
          ? serverVault.authRequired
            ? 'Sign out of the server vault'
            : 'Leave the server vault'
          : 'Switch to the server vault',
        icon: Server,
        keywords: 'server vault docker remote sign out log out switch hosted',
        run: () => (usingServerVault ? void signOutServer() : connectServer()),
      })
    }

    if (activeNote) {
      list.push({
        id: 'history',
        label: 'Version history',
        icon: History,
        keywords: 'versions snapshots restore undo backup',
        run: () => void openHistory(),
      })
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
      list.push({
        id: 'bookmark-selection',
        label: 'Save selection as bookmark',
        icon: Bookmark,
        keywords: 'bookmark link url save page product',
        run: captureSelectionBookmark,
      })
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
    openImport,
    openFolderImport,
    openHistory,
    toggleAssistant,
    toggleTasks,
    toggleBookmarks,
    captureSelectionBookmark,
    activeNote,
    handleDelete,
    editor,
  ])

  // ---- Vault gate: shown until a vault is connected ----
  if (status !== 'ready') {
    return (
      <VaultGate
        status={status}
        theme={theme}
        toggleTheme={toggleTheme}
        vaultName={vaultName}
        connect={() => void connect()}
        reconnect={() => void reconnect()}
        serverVault={serverVault}
        connectServer={connectServer}
        loginServer={loginServer}
      />
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
        onDeleteFolder={handleDeleteFolder}
        onRenameFolder={handleRenameFolder}
        onMoveNote={(id, target) => void moveNote(id, target)}
        onDelete={handleDelete}
        onSwitchVault={() => void connect()}
        onOpenTrash={() => void openTrash()}
        onOpenTasks={toggleTasks}
        onOpenBookmarks={toggleBookmarks}
        onOpenImport={openImport}
        onOpenFolderImport={openFolderImport}
        onDropFiles={handleDropFiles}
        onOpenExport={() => setExportOpen(true)}
      />

      <TaskPanel
        open={tasksOpen}
        tab={panelTab}
        onTabChange={setPanelTab}
        onClose={() => setTasksOpen(false)}
        tasks={tasks}
        bookmarks={bookmarks}
        onOpenNote={handleSelect}
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
          onOpenHistory={() => void openHistory()}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onToggleFocus={toggleFocus}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenAssistant={toggleAssistant}
          onInlineAsk={assistant.complete}
          onAddTask={addTaskFromText}
          onAddBookmark={captureSelectionBookmark}
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

      <ExportModal
        open={exportOpen}
        dir={vaultDir}
        vaultName={vaultName}
        noteCount={notes.length}
        onClose={() => setExportOpen(false)}
      />

      {/* Import pickers: one for loose files, one for a whole folder. Owned
          here so both the sidebar and the command palette can open them. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".md,.markdown,.txt,.text,text/markdown,text/plain"
        className="visually-hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleImportFiles(e.target.files)
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="visually-hidden"
        {...DIRECTORY_PROPS}
        onChange={(e) => {
          if (e.target.files?.length) handleImportFiles(e.target.files)
        }}
      />

      <HistoryModal
        open={historyOpen}
        noteTitle={activeNote?.title ?? ''}
        items={historyItems}
        onClose={() => setHistoryOpen(false)}
        onRestore={(name) => void restoreVersion(name)}
        onDelete={(name) => void deleteVersion(name)}
        loadContent={previewVersion}
      />

      <AssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        filePaths={notes.map((n) => n.id)}
        activePath={activeNote?.id ?? null}
        settings={assistant.settings}
        onUpdateSettings={assistant.updateSettings}
        messages={assistant.messages}
        status={assistant.status}
        pending={assistant.pending}
        onSend={assistant.send}
        onApprove={assistant.approve}
        onReject={assistant.reject}
        onApproveAll={assistant.approveAll}
        onStop={assistant.stop}
        onClear={assistant.clear}
      />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
