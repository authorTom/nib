import { useCallback, useEffect, useState } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import TopBar from './TopBar'
import Toolbar from './Toolbar'
import NoteTabs from './NoteTabs'
import EditorPane from './EditorPane'
import EditorSkeleton from './EditorSkeleton'
import type { NoteFile } from '../fs/vault'
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
  lastSavedAt: number | null
  isDirty: (id: string) => boolean
  /** Note created moments ago, for the ink bloom and the wet-ink tab. */
  justCreatedId: string | null
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
  lastSavedAt,
  isDirty,
  justCreatedId,
  flightFrom,
  enterFrom,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onReorderTabs,
  onToggleSplit,
  onCloseSplit,
  onContentChange,
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
      />

      {focusedEditor && <Toolbar editor={focusedEditor} />}

      <div className={`panes${split ? ' split' : ''}`}>
        {activeNote && activeContent !== null ? (
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
