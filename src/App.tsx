import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  Columns2,
  FileDown,
  FolderOpen,
  FolderPlus,
  History,
  ListTodo,
  Maximize2,
  Minimize2,
  Moon,
  Package,
  Palette,
  Plus,
  Server,
  Sparkles,
  Sun,
  Trash2,
  Keyboard,
  Upload,
  X,
} from 'lucide-react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import CommandPalette, { type Command } from './components/CommandPalette'
import TrashModal from './components/TrashModal'
import ExportModal from './components/ExportModal'
import HistoryModal from './components/HistoryModal'
import ConfirmDialog, { type ConfirmRequest } from './components/ConfirmDialog'
import ThemePicker from './components/ThemePicker'
import ResizeCrew from './components/ResizeCrew'
import { EASTER_EGG_KEYWORDS } from './themes/themes'
import AssistantPanel from './components/AssistantPanel'
import TaskPanel from './components/TaskPanel'
import LibraryGate from './components/LibraryGate'
import InkFilter from './components/InkFilter'
import ShortcutsModal from './components/ShortcutsModal'
import { useAssistant } from './ai/useAssistant'
import { useTasks } from './tasks/useTasks'
import { useBookmarks } from './bookmarks/useBookmarks'
import { domainOf, findUrl, normalizeUrl } from './bookmarks/url'
import {
  blockActions,
  formatActions,
  headingActions,
  listActions,
} from './components/formatActions'
import { deriveTitleFromMarkdown, isGeneratedTitle } from './lib/format'
import { MOD_KEY } from './lib/platform'
import { exportToPdf } from './lib/exportPdf'
import { downloadMarkdown } from './lib/exportMarkdown'
import { serialize } from './editor/markdown'
import {
  selectionFromDataTransfer,
  selectionFromFiles,
  type ImportSelection,
} from './lib/importMarkdown'
import { useTheme } from './hooks/useTheme'
import { useNotes } from './hooks/useNotes'
import type { EnterFrom, FlightOrigin } from './lib/motion'
import { useBacklinks } from './hooks/useBacklinks'
import { useResizable } from './hooks/useResizable'
import { useDeferredUnmount } from './hooks/useDeferredUnmount'
import { useEnterExit } from './hooks/useEnterExit'
import { supportsDiskPicker } from './fs/library'

/**
 * True when the keystroke belongs to whatever the user is writing in.
 *
 * The editor is a contenteditable, so `isContentEditable` matters as much as
 * the input tags — without it, typing "?" in a note would open a dialog.
 */
function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** `webkitdirectory` is how every browser exposes folder picking, but it isn't
 *  in React's typed attribute list — assert it once here rather than at each use. */
const DIRECTORY_PROPS = { webkitdirectory: '', directory: '' } as unknown as
  React.InputHTMLAttributes<HTMLInputElement>

export default function App() {
  const {
    theme,
    toggleTheme,
    palette,
    setPalette,
    availableThemes,
    unlockTheme,
  } = useTheme()
  const {
    status,
    libraryName,
    libraryDir,
    reload,
    tree,
    notes,
    activeNote,
    activeId,
    activeContent,
    openNotes,
    openNote,
    openNoteInPane,
    closeTab,
    closeOtherTabs,
    moveTab,
    splitId,
    splitNote,
    splitContent,
    setSplitId,
    toggleSplit,
    focusedPane,
    setFocusedPane,
    saveState,
    saveError,
    lastSavedAt,
    dirtyIds,
    justCreatedId,
    justPlacedId,
    connect,
    reconnect,
    serverLibrary,
    usingServerLibrary,
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
    renameNote,
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

  // A single confirmation slot: any caller raises one by describing it, rather
  // than reaching for window.confirm.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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

  // Docked panels stay mounted for the length of their slide-out, so closing
  // one animates instead of vanishing. Matches --dur-slow.
  const PANEL_EXIT_MS = 260
  const renderTasks = useDeferredUnmount(tasksOpen, PANEL_EXIT_MS)
  const renderAssistant = useDeferredUnmount(assistantOpen, PANEL_EXIT_MS)

  // ---- Resizable docked panels ----
  const sidebarResize = useResizable({
    storageKey: 'deckle-width-sidebar',
    defaultWidth: 280,
    min: 200,
    max: 520,
    edge: 'right',
  })
  const taskResize = useResizable({
    storageKey: 'deckle-width-tasks',
    defaultWidth: 340,
    min: 260,
    max: 560,
    edge: 'right',
  })
  const assistantResize = useResizable({
    storageKey: 'deckle-width-assistant',
    defaultWidth: 380,
    min: 300,
    max: 640,
    edge: 'left',
  })

  // Tasks (Todoist-style planner, stored in the library's .deckle/tasks.json)
  const tasks = useTasks(libraryDir)

  // Bookmarks (stored in the library's .deckle/bookmarks.json)
  const bookmarks = useBookmarks(libraryDir)

  // Wikilink backlinks, one index per pane.
  const backlinks = useBacklinks(libraryDir, notes, activeId)
  const splitBacklinks = useBacklinks(libraryDir, notes, splitId)

  // Transient confirmation toast (e.g. after capturing a task).
  const [toast, setToast] = useState<string | null>(null)
  const [toastTone, setToastTone] = useState<'default' | 'danger'>('default')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showToast = useCallback(
    (msg: string, tone: 'default' | 'danger' = 'default') => {
      setToast(msg)
      setToastTone(tone)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      // A confirmation can go as soon as it's been read; a failure is a whole
      // sentence naming a thing to fix, and needs long enough to finish it.
      toastTimer.current = setTimeout(
        () => setToast(null),
        tone === 'danger' ? 7000 : 2200,
      )
    },
    [],
  )
  // Held past the dismissal so the toast can animate back down.
  const toastAnim = useEnterExit(toast !== null, 180)
  const [toastText, setToastText] = useState('')
  useEffect(() => {
    if (toast) setToastText(toast)
  }, [toast])

  // ---- Naming a note after its own heading ----
  // Set for the length of a rename, so the pane that re-keys underneath it
  // doesn't grab the caret back from whatever the user just clicked.
  const renaming = useRef(false)
  const shouldClaimFocus = useCallback(() => !renaming.current, [])

  const nameNoteAfterHeading = useCallback(
    (noteId: string, markdown: string) => {
      const note = notes.find((n) => n.id === noteId)
      // Only ever renames away from the name Deckle invented. A title the user
      // typed is theirs, even when the heading later says something else.
      if (!note || !isGeneratedTitle(note.title)) return
      const derived = deriveTitleFromMarkdown(markdown)
      if (!derived || derived === note.title) return
      renaming.current = true
      void renameNote(noteId, derived).finally(() => {
        renaming.current = false
      })
    },
    [notes, renameNote],
  )

  // A failed write says its piece once, in full. The top bar keeps the
  // persistent "Not saved" state after the toast has gone, so the message is
  // the explanation and the chip is the reminder.
  useEffect(() => {
    if (saveError) showToast(saveError, 'danger')
  }, [saveError, showToast])

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
  const getDir = useCallback(() => libraryDir, [libraryDir])
  const onAssistantMutated = useCallback(() => void reload(), [reload])
  const getActivePath = useCallback(() => activeNote?.id ?? null, [activeNote])
  const assistant = useAssistant({
    getDir,
    onMutated: onAssistantMutated,
    getActivePath,
  })

  // Keyboard shortcuts: Ctrl/Cmd+K opens the palette,
  // Ctrl/Cmd+Shift+F toggles focus, Ctrl/Cmd+\ splits, Escape exits focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        toggleSplit()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleFocus()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        // Capture the selection as a task; with no selection, toggle the panel.
        e.preventDefault()
        if (!captureSelectionTask()) toggleTasks()
      } else if (e.key === '?' && !mod && !isTypingTarget()) {
        // Guarded hard: a question mark is a character before it is a command,
        // and the editor must never lose one to a dialog.
        e.preventDefault()
        setShortcutsOpen(true)
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'w') {
        // Close the focused tab. Deliberately NOT plain Ctrl/Cmd+W: browsers
        // reserve that one and ignore preventDefault, so binding it closed the
        // whole app — taking any buffered keystrokes with it.
        e.preventDefault()
        if (activeId) closeTab(activeId)
      } else if (e.key === 'Escape') {
        // Close the topmost layer first; only exit focus mode if nothing is open.
        // (The command palette and confirm dialog handle their own Escape.)
        if (historyOpen) setHistoryOpen(false)
        else if (trashOpen) setTrashOpen(false)
        else setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    toggleFocus,
    toggleSplit,
    trashOpen,
    historyOpen,
    captureSelectionTask,
    toggleTasks,
    closeTab,
    activeId,
  ])

  // ---- Note-switch choreography ----
  // Both are set at the click, not in an effect afterwards: the pane remounts in
  // the same commit as the id change, so anything computed later would arrive a
  // switch too late and animate the wrong way.
  const [flightFrom, setFlightFrom] = useState<FlightOrigin | null>(null)
  const [enterFrom, setEnterFrom] = useState<EnterFrom | undefined>()

  /** Which way along the tab strip this switch travels, if it's on the strip. */
  const directionTo = useCallback(
    (id: string): EnterFrom | undefined => {
      const from = openNotes.findIndex((n) => n.id === activeId)
      const to = openNotes.findIndex((n) => n.id === id)
      if (from === -1 || to === -1 || from === to) return undefined
      return to > from ? 'right' : 'left'
    },
    [openNotes, activeId],
  )

  /** Open a note from the sidebar, palette, or a wikilink. */
  const handleSelect = useCallback(
    (id: string, origin: FlightOrigin | null = null) => {
      setFlightFrom(origin)
      setEnterFrom(undefined) // a jump from outside the strip has no direction
      openNote(id)
      closeSidebar()
    },
    [openNote, closeSidebar],
  )

  const handleSelectTab = useCallback(
    (id: string, origin: FlightOrigin | null) => {
      setFlightFrom(origin)
      setEnterFrom(directionTo(id))
      openNote(id)
    },
    [openNote, directionTo],
  )

  /** A wikilink click lands in whichever pane the reader was already in. */
  const handleOpenInPane = useCallback(
    (id: string) => openNoteInPane(id, focusedPane),
    [openNoteInPane, focusedPane],
  )

  // Deleting moves the note to the recycle bin (recoverable), so no confirm.
  const handleDelete = useCallback(
    (id: string) => {
      void deleteNote(id)
    },
    [deleteNote],
  )

  const handleCreateFolder = useCallback(
    (parentPath: string, name: string) => {
      void createFolder(parentPath, name)
    },
    [createFolder],
  )

  const handleDeleteFolder = useCallback(
    (folderPath: string) => {
      const name = folderPath.includes('/')
        ? folderPath.slice(folderPath.lastIndexOf('/') + 1)
        : folderPath
      setConfirmRequest({
        title: `Delete “${name}”?`,
        body: 'Its notes move to the Recycle Bin, where you can restore them.',
        confirmLabel: 'Delete folder',
        danger: true,
        onConfirm: () => void deleteFolder(folderPath),
      })
    },
    [deleteFolder],
  )

  const handleRenameFolder = useCallback(
    (folderPath: string, newName: string) => {
      void renameFolder(folderPath, newName)
    },
    [renameFolder],
  )

  const handleRenameNote = useCallback(
    (id: string, newTitle: string) => {
      void renameNote(id, newTitle)
    },
    [renameNote],
  )

  const handleSaveMarkdown = useCallback(() => {
    if (!editor || !activeNote) return
    downloadMarkdown(activeNote.title, serialize(editor))
  }, [editor, activeNote])

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
        // Naming happens inline in the tree, so open the sidebar to show it.
        run: () => setSidebarOpen(true),
      },
      {
        id: 'split',
        label: splitId ? 'Close split view' : 'Split editor',
        icon: Columns2,
        hint: 'Ctrl/Cmd+\\',
        keywords: 'split pane side by side compare two',
        run: toggleSplit,
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
        keywords: 'theme appearance dark light mode',
        run: () => toggleTheme(),
      },
      {
        id: 'appearance',
        label: 'Appearance & themes…',
        icon: Palette,
        keywords: 'theme colour color palette appearance skin style look',
        run: () => setThemePickerOpen(true),
      },
      {
        id: 'open-folder',
        label: supportsDiskPicker()
          ? 'Open a different folder'
          : 'Use the library in this browser',
        icon: FolderOpen,
        keywords: 'library switch change local folder',
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
        keywords: 'import upload md markdown add files migrate',
        run: openImport,
      },
      {
        id: 'import-folder',
        label: 'Import a folder of notes',
        icon: FolderOpen,
        keywords: 'import upload folder directory bulk migrate restore',
        run: openFolderImport,
      },
      {
        id: 'export-zip',
        label: 'Export knowledge base as ZIP',
        icon: Package,
        keywords: 'export download backup zip archive everything library',
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
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        icon: Keyboard,
        hint: '?',
        keywords: 'keys keyboard shortcuts bindings help reference cheatsheet',
        run: () => setShortcutsOpen(true),
      },
    ]

    // Every unlocked theme is reachable by name, but hidden so six extra rows
    // don't pad the palette's default list.
    for (const t of availableThemes) {
      list.push({
        id: `theme-${t.id}`,
        label: `Theme: ${t.name}`,
        icon: Palette,
        section: 'Appearance',
        keywords: `theme colour color palette appearance ${t.name}`,
        hidden: true,
        run: () => setPalette(t.id),
      })
    }

    // The one you have to go looking for. Once found it joins the picker and
    // the list above, so this only exists while it's still a secret.
    if (!availableThemes.some((t) => t.id === 'springfield')) {
      list.push({
        id: 'unlock-springfield',
        label: '🍩 Mmm… a theme you were not supposed to find',
        icon: Palette,
        section: 'Appearance',
        keywords: EASTER_EGG_KEYWORDS,
        hidden: true,
        run: () => {
          unlockTheme('springfield')
          showToast('Woo-hoo! Springfield theme unlocked')
        },
      })
    }

    // Only offered where a server library actually exists (Docker deployments
    // with a volume mounted).
    if (serverLibrary) {
      list.push({
        id: 'server-library',
        label: usingServerLibrary
          ? serverLibrary.authRequired
            ? 'Sign out of the server library'
            : 'Leave the server library'
          : 'Switch to the server library',
        icon: Server,
        keywords: 'server library docker remote sign out log out switch hosted',
        run: () => (usingServerLibrary ? void signOutServer() : connectServer()),
      })
    }

    if (activeNote) {
      list.push({
        id: 'close-tab',
        label: 'Close tab',
        icon: X,
        // Advertised here because the shortcut is deliberately not the browser's
        // Ctrl/Cmd+W, so nobody will guess it.
        hint: 'Ctrl/Cmd+Shift+W',
        keywords: 'close tab hide note dismiss',
        run: () => closeTab(activeNote.id),
      })
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
      for (const action of [
        ...headingActions,
        ...formatActions,
        ...listActions,
        ...blockActions,
      ]) {
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
    toggleSplit,
    splitId,
    toggleFocus,
    theme,
    toggleTheme,
    availableThemes,
    setPalette,
    unlockTheme,
    showToast,
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
    serverLibrary,
    usingServerLibrary,
    connectServer,
    signOutServer,
  ])

  // ---- Library gate: shown until a library is connected ----
  if (status !== 'ready') {
    return (
      <LibraryGate
        status={status}
        theme={theme}
        toggleTheme={() => toggleTheme()}
        libraryName={libraryName}
        connect={() => void connect()}
        reconnect={() => void reconnect()}
        serverLibrary={serverLibrary}
        connectServer={connectServer}
        loginServer={loginServer}
      />
    )
  }

  // ---- Ready: full app ----
  return (
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      <div
        className="sidebar-dock"
        style={{ width: sidebarResize.width }}
      >
        <Sidebar
          tree={tree}
          activeId={activeId}
          open={sidebarOpen}
          libraryName={libraryName}
          query={query}
          searchResults={searchResults}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          justCreatedId={justCreatedId}
          justPlacedId={justPlacedId}
          onCreate={() => {
            void createNote()
            closeSidebar()
          }}
          onCreateInFolder={(folderPath) => void createNote(folderPath)}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onRenameFolder={handleRenameFolder}
          onRenameNote={handleRenameNote}
          onMoveNote={(id, target) => void moveNote(id, target)}
          onDelete={handleDelete}
          onSwitchLibrary={() => void connect()}
          onOpenTrash={() => void openTrash()}
          onOpenTasks={toggleTasks}
          onOpenBookmarks={toggleBookmarks}
          onOpenImport={openImport}
          onOpenFolderImport={openFolderImport}
          onDropFiles={handleDropFiles}
          onOpenExport={() => setExportOpen(true)}
        />
        <div {...sidebarResize.handleProps} aria-label="Resize note list" />
      </div>

      <div
        className={`task-dock${tasksOpen ? ' open' : ''}`}
        style={{ width: tasksOpen ? taskResize.width : 0 }}
      >
        <TaskPanel
          open={renderTasks}
          tab={panelTab}
          onTabChange={setPanelTab}
          onClose={() => setTasksOpen(false)}
          tasks={tasks}
          bookmarks={bookmarks}
          onOpenNote={handleSelect}
        />
        {tasksOpen && (
          <div {...taskResize.handleProps} aria-label="Resize tasks panel" />
        )}
      </div>

      <div
        className={`scrim${sidebarOpen ? ' show' : ''}`}
        onClick={closeSidebar}
      />

      <Workspace
        notes={notes}
        openNotes={openNotes}
        activeNote={activeNote}
        activeContent={activeContent}
        splitNote={splitNote}
        splitContent={splitContent}
        focusedPane={focusedPane}
        onFocusPane={setFocusedPane}
        backlinks={backlinks}
        splitBacklinks={splitBacklinks}
        saveState={saveState}
        saveError={saveError}
        lastSavedAt={lastSavedAt}
        isDirty={(id) => dirtyIds.includes(id)}
        libraryEmpty={notes.length === 0}
        justCreatedId={justCreatedId}
        justPlacedId={justPlacedId}
        flightFrom={flightFrom}
        enterFrom={enterFrom}
        onSelectTab={handleSelectTab}
        onCloseTab={closeTab}
        onCloseOtherTabs={closeOtherTabs}
        onReorderTabs={moveTab}
        onToggleSplit={toggleSplit}
        onCloseSplit={() => setSplitId(null)}
        onContentChange={saveContent}
        onLeaveNote={nameNoteAfterHeading}
        shouldClaimFocus={shouldClaimFocus}
        onOpenNote={handleOpenInPane}
        onTitleCommit={handleRenameNote}
        onNew={() => void createNote()}
        onSaveMarkdown={handleSaveMarkdown}
        onExportPdf={() => activeNote && exportToPdf(activeNote.title)}
        onOpenHistory={() => void openHistory()}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onToggleFocus={toggleFocus}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenAssistant={toggleAssistant}
        onOpenTrash={() => void openTrash()}
        onOpenImport={openImport}
        onOpenExport={() => setExportOpen(true)}
        onOpenAppearance={() => setThemePickerOpen(true)}
        onInlineAsk={assistant.complete}
        onAddTask={addTaskFromText}
        onAddBookmark={captureSelectionBookmark}
        onFocusedEditorChange={setEditor}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div
        className={`assistant-dock${assistantOpen ? ' open' : ''}`}
        style={{ width: assistantOpen ? assistantResize.width : 0 }}
      >
        {assistantOpen && (
          <div {...assistantResize.handleProps} aria-label="Resize assistant panel" />
        )}
        <AssistantPanel
          open={renderAssistant}
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
      </div>

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
        onRestore={(name) => {
          void restoreFromTrash(name).then(() =>
            showToast('Back where it was, with its history intact'),
          )
        }}
        onDeleteForever={(name) => void deleteFromTrash(name)}
        onEmpty={() => void emptyTrash()}
      />

      <ExportModal
        open={exportOpen}
        dir={libraryDir}
        libraryName={libraryName}
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
        onRestore={(name) => {
          void restoreVersion(name).then(() =>
            showToast('Restored — and the version you were on was saved first'),
          )
        }}
        onDelete={(name) => void deleteVersion(name)}
        loadContent={previewVersion}
      />

      <ConfirmDialog
        request={confirmRequest}
        onClose={() => setConfirmRequest(null)}
      />

      {/* Whichever divider is being dragged gets the crew. Only one can be
          active at a time, so they never collide. */}
      <ResizeCrew
        dragging={sidebarResize.dragging}
        drag={sidebarResize.drag}
        handleRef={sidebarResize.handleRef}
      />
      <ResizeCrew
        dragging={taskResize.dragging}
        drag={taskResize.drag}
        handleRef={taskResize.handleRef}
      />
      <ResizeCrew
        dragging={assistantResize.dragging}
        drag={assistantResize.drag}
        handleRef={assistantResize.handleRef}
      />

      <ThemePicker
        open={themePickerOpen}
        onClose={() => setThemePickerOpen(false)}
        themes={availableThemes}
        palette={palette}
        onPickPalette={(id, e) => setPalette(id, e)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        mod={MOD_KEY}
      />

      <InkFilter />

      {toastAnim.render && (
        <div
          className={`toast${toastAnim.entered ? ' entered' : ''}${
            toastTone === 'danger' ? ' danger' : ''
          }`}
          role={toastTone === 'danger' ? 'alert' : 'status'}
        >
          {toastText}
        </div>
      )}
    </div>
  )
}
