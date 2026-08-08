import { useCallback, useEffect, useState } from 'react'
import { FilePlus, Upload } from 'lucide-react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import TopBar from './TopBar'
import Toolbar from './Toolbar'
import NoteTabs from './NoteTabs'
import EditorPane from './EditorPane'
import EditorSkeleton from './EditorSkeleton'
import type { NoteFile } from '../fs/library'
import type { Pane, SaveState } from '../hooks/useNotes'
import type { Backlink } from '../lib/wikilinks'
import type { EnterFrom, FlightOrigin } from '../lib/motion'
import type { Theme } from '../hooks/useTheme'

interface WorkspaceProps {
  notes: NoteFile[]
  openNotes: NoteFile[]
  activeNote: NoteFile | null
  activeContent: string | null
  splitNote: NoteFile | null
  splitContent: string | null
  focusedPane: Pane
  onFocusPane: (pane: Pane) => void
  backlinks: Backlink[]
  splitBacklinks: Backlink[]
  saveState: SaveState
  saveError: string | null
  lastSavedAt: number | null
  isDirty: (id: string) => boolean
  /** The library has no notes at all — show the first-run state in the panes. */
  libraryEmpty: boolean
  /** Note created moments ago, for the ink bloom and the wet-ink tab. */
  justCreatedId: string | null
  /** Note restored moments ago: wet ink, but no bloom — it was placed, not made. */
  justPlacedId: string | null
  /** Where the current switch was triggered from, for the title flight. */
  flightFrom: FlightOrigin | null
  enterFrom?: EnterFrom

  onSelectTab: (id: string, origin: FlightOrigin | null) => void
  onCloseTab: (id: string) => void
  onCloseOtherTabs: (id: string) => void
  onReorderTabs: (id: string, toIndex: number) => void
  onToggleSplit: () => void
  onCloseSplit: () => void

  onContentChange: (noteId: string, markdown: string) => void
  /** Leaving a note is the moment it may take its name from its first heading. */
  onLeaveNote: (noteId: string, markdown: string) => void
  /** Veto for a pane taking the caret at mount (see EditorPane). */
  shouldClaimFocus: () => boolean
  onOpenNote: (id: string) => void
  onTitleCommit: (noteId: string, title: string) => void
  onNew: () => void
  onSaveMarkdown: () => void
  onExportPdf: () => void
  onOpenHistory: () => void
  onToggleSidebar: () => void
  onToggleFocus: () => void
  onOpenPalette: () => void
  onOpenAssistant: () => void
  onOpenTrash: () => void
  onOpenImport: () => void
  onOpenExport: () => void
  onOpenAppearance: () => void
  onInlineAsk: (
    instruction: string,
    selectedText: string,
    signal: AbortSignal,
  ) => Promise<string>
  onAddTask: (text: string) => void
  onAddBookmark: () => void
  /** The editor belonging to whichever pane has focus, for the palette. */
  onFocusedEditorChange: (editor: TiptapEditor | null) => void
  theme: Theme
  onToggleTheme: (e: React.MouseEvent) => void
}

/**
 * What a brand-new library opens on.
 *
 * Lives inside the panes rather than over the whole app: it used to be an
 * opaque overlay across `.app`, which covered the sidebar it was telling you
 * to use — while `pointer-events: none` left that hidden sidebar clickable.
 * Here the note list stays visible beside it, so "bring in Markdown" points at
 * something the reader can actually see.
 */
function EmptyLibrary({
  onNew,
  onImport,
}: {
  onNew: () => void
  onImport: () => void
}) {
  return (
    <div className="empty-state">
      <h2>No notes yet</h2>
      <p>
        Start one here, or bring in Markdown you already have — loose files, a
        folder, or a ZIP. Nested folders keep their structure and nothing is
        overwritten.
      </p>
      <div className="empty-actions">
        <button type="button" className="btn-primary" onClick={onNew}>
          <FilePlus size={18} />
          New note
        </button>
        <button type="button" className="btn-secondary" onClick={onImport}>
          <Upload size={16} />
          Import Markdown or ZIP…
        </button>
      </div>
    </div>
  )
}

/**
 * Everything to the right of the sidebar: title chrome, the tab strip, one
 * shared formatting toolbar, and one or two editor panes.
 *
 * The toolbar lives here rather than inside each pane so a split shows one set
 * of formatting controls, bound to whichever pane the user last touched.
 */
export default function Workspace({
  notes,
  openNotes,
  activeNote,
  activeContent,
  splitNote,
  splitContent,
  focusedPane,
  onFocusPane,
  backlinks,
  splitBacklinks,
  saveState,
  saveError,
  lastSavedAt,
  isDirty,
  libraryEmpty,
  justCreatedId,
  justPlacedId,
  flightFrom,
  enterFrom,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onReorderTabs,
  onToggleSplit,
  onCloseSplit,
  onContentChange,
  onLeaveNote,
  shouldClaimFocus,
  onOpenNote,
  onTitleCommit,
  onNew,
  onSaveMarkdown,
  onExportPdf,
  onOpenHistory,
  onToggleSidebar,
  onToggleFocus,
  onOpenPalette,
  onOpenAssistant,
  onOpenTrash,
  onOpenImport,
  onOpenExport,
  onOpenAppearance,
  onInlineAsk,
  onAddTask,
  onAddBookmark,
  onFocusedEditorChange,
  theme,
  onToggleTheme,
}: WorkspaceProps) {
  const [primaryEditor, setPrimaryEditor] = useState<TiptapEditor | null>(null)
  const [splitEditor, setSplitEditor] = useState<TiptapEditor | null>(null)

  const focusPrimary = useCallback(() => onFocusPane('primary'), [onFocusPane])
  const focusSplit = useCallback(() => onFocusPane('split'), [onFocusPane])

  const focusedEditor =
    focusedPane === 'split' && splitNote ? splitEditor : primaryEditor
  const focusedNote = focusedPane === 'split' && splitNote ? splitNote : activeNote

  useEffect(() => {
    onFocusedEditorChange(focusedEditor)
  }, [focusedEditor, onFocusedEditorChange])

  const split = splitNote !== null

  return (
    <div className="main">
      <TopBar
        title={focusedNote?.title ?? ''}
        onTitleCommit={(title) => {
          if (focusedNote) onTitleCommit(focusedNote.id, title)
        }}
        onNew={onNew}
        onSaveMarkdown={onSaveMarkdown}
        onExportPdf={onExportPdf}
        onOpenHistory={onOpenHistory}
        onToggleSidebar={onToggleSidebar}
        onToggleFocus={onToggleFocus}
        onOpenPalette={onOpenPalette}
        onOpenAssistant={onOpenAssistant}
        onOpenTrash={onOpenTrash}
        onOpenImport={onOpenImport}
        onOpenExport={onOpenExport}
        onOpenAppearance={onOpenAppearance}
        onToggleSplit={onToggleSplit}
        isSplit={split}
        saveState={saveState}
        saveError={saveError}
        lastSavedAt={lastSavedAt}
        theme={theme}
        onToggleTheme={onToggleTheme}
        hasNote={!!focusedNote}
      />

      <NoteTabs
        notes={openNotes}
        activeId={activeNote?.id ?? null}
        splitId={splitNote?.id ?? null}
        onSelect={onSelectTab}
        onClose={onCloseTab}
        onCloseOthers={onCloseOtherTabs}
        onReorder={onReorderTabs}
        onToggleSplit={onToggleSplit}
        isDirty={isDirty}
        justCreatedId={justCreatedId}
        justPlacedId={justPlacedId}
      />

      {focusedEditor && <Toolbar editor={focusedEditor} />}

      <div className={`panes${split ? ' split' : ''}`}>
        {libraryEmpty ? (
          <EmptyLibrary onNew={onNew} onImport={onOpenImport} />
        ) : activeNote && activeContent !== null ? (
          <EditorPane
            key={activeNote.id}
            noteId={activeNote.id}
            content={activeContent}
            notes={notes}
            backlinks={backlinks}
            focused={focusedPane === 'primary' || !split}
            isNew={activeNote.id === justCreatedId}
            flightFrom={flightFrom}
            enterFrom={enterFrom}
            paneLabel={split ? activeNote.title : undefined}
            onFocusPane={focusPrimary}
            onContentChange={onContentChange}
            onLeaveNote={onLeaveNote}
            shouldClaimFocus={shouldClaimFocus}
            onOpenNote={onOpenNote}
            onInlineAsk={onInlineAsk}
            onAddTask={onAddTask}
            onAddBookmark={onAddBookmark}
            onEditorReady={setPrimaryEditor}
          />
        ) : (
          <EditorSkeleton />
        )}

        {split && (
          <>
            <div className="pane-divider" aria-hidden="true" />
            {splitNote && splitContent !== null ? (
              <EditorPane
                key={`split-${splitNote.id}`}
                noteId={splitNote.id}
                content={splitContent}
                notes={notes}
                backlinks={splitBacklinks}
                focused={focusedPane === 'split'}
                paneLabel={splitNote.title}
                onClosePane={onCloseSplit}
                onFocusPane={focusSplit}
                onContentChange={onContentChange}
                onLeaveNote={onLeaveNote}
                shouldClaimFocus={shouldClaimFocus}
                onOpenNote={onOpenNote}
                onInlineAsk={onInlineAsk}
                onAddTask={onAddTask}
                onAddBookmark={onAddBookmark}
                onEditorReady={setSplitEditor}
              />
            ) : (
              <EditorSkeleton />
            )}
          </>
        )}
      </div>
    </div>
  )
}
