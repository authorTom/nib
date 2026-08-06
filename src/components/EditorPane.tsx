import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useEditor,
  EditorContent,
  BubbleMenu,
  type Editor as TiptapEditor,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { BookmarkPlus, Brain, SquareCheckBig, X } from 'lucide-react'
import InlineAssistant from './InlineAssistant'
import WikilinkSuggest from './WikilinkSuggest'
import Outline from './Outline'
import Backlinks from './Backlinks'
import { formatActions, listActions, type FormatAction } from './formatActions'
import { Wikilink } from '../editor/wikilink'
import { serialize } from '../editor/markdown'
import {
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableHeader,
  MarkdownTableRow,
} from '../editor/markdownTable'
import { resolveWikilink, type Backlink } from '../lib/wikilinks'
import {
  prefersReducedMotion,
  type EnterFrom,
  type FlightOrigin,
} from '../lib/motion'
import type { NoteFile } from '../fs/vault'

const lowlight = createLowlight(common)

interface EditorPaneProps {
  noteId: string
  content: string
  /** Every note in the vault — wikilink resolution and the `[[` picker need it. */
  notes: NoteFile[]
  backlinks: Backlink[]
  /** True when this pane owns the toolbar and the topbar title. */
  focused: boolean
  /** The note was created moments ago — play the ink bloom across the page. */
  isNew?: boolean
  /** Screen rect of whatever was clicked to open this note. */
  flightFrom?: FlightOrigin | null
  /** Side to slide in from, when the switch had a direction. */
  enterFrom?: EnterFrom
  /** Rendered as a pane header when the editor is split. */
  paneLabel?: string
  onClosePane?: () => void
  onFocusPane: () => void
  onContentChange: (noteId: string, markdown: string) => void
  onOpenNote: (noteId: string) => void
  onInlineAsk: (
    instruction: string,
    selectedText: string,
    signal: AbortSignal,
  ) => Promise<string>
  onAddTask: (text: string) => void
  onAddBookmark: () => void
  onEditorReady: (editor: TiptapEditor | null) => void
}

/**
 * One editing surface: the TipTap instance plus everything anchored to it —
 * selection bubble menu, `[[` picker, outline, and backlinks.
 *
 * The workspace renders one of these per pane, so all pane-local state stays
 * here and nothing has to be duplicated when a second pane opens.
 */
export default function EditorPane({
  noteId,
  content,
  notes,
  backlinks,
  focused,
  isNew = false,
  flightFrom,
  enterFrom,
  paneLabel,
  onClosePane,
  onFocusPane,
  onContentChange,
  onOpenNote,
  onInlineAsk,
  onAddTask,
  onAddBookmark,
  onEditorReady,
}: EditorPaneProps) {
  const [aiOpen, setAiOpen] = useState(false)
  const [aiRange, setAiRange] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)
  // Read inside the bubble-menu shouldShow (which may capture a stale closure).
  const aiOpenRef = useRef(false)
  aiOpenRef.current = aiOpen

  // The wikilink extension is built once, but resolution has to see the current
  // note list — so it reads through refs rather than being rebuilt per render.
  const notesRef = useRef(notes)
  notesRef.current = notes
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId
  const onOpenNoteRef = useRef(onOpenNote)
  onOpenNoteRef.current = onOpenNote

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Markdown.configure({ linkify: true, breaks: true, transformPastedText: true }),
      Link.configure({ openOnClick: true, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownTable.configure({ resizable: true }),
      MarkdownTableRow,
      MarkdownTableHeader,
      MarkdownTableCell,
      CodeBlockLowlight.configure({ lowlight }),
      Wikilink.configure({
        resolve: (target) =>
          resolveWikilink(target, notesRef.current, noteIdRef.current),
        onOpen: (id) => onOpenNoteRef.current(id),
      }),
    ],
    [],
  )

  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: ({ editor }) => {
      onContentChange(noteId, serialize(editor))
    },
    onFocus: onFocusPane,
  })

  // Load the note's markdown into the editor when it's ready, and re-sync if the
  // content changes underneath us — e.g. the AI assistant edits the open note.
  // `content` only changes on a fresh load from disk (typing doesn't update it),
  // so this won't fire on the user's own keystrokes. The guard avoids resetting
  // the cursor when the incoming text already matches what's in the editor.
  useEffect(() => {
    if (!editor) return
    if (content === serialize(editor)) return
    editor.commands.setContent(content, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, content])

  // The note's heading flies out of whatever was clicked to open it — the tab,
  // or the row in the tree. Declared after the effect that loads the content,
  // and deliberately a passive effect rather than a layout one, so the heading
  // exists in the DOM by the time this measures it.
  const flown = useRef(false)
  useEffect(() => {
    if (!editor || !flightFrom || flown.current || prefersReducedMotion()) return
    // Once per mount, and a mount is one note. Without the guard React's
    // development double-invoke restarts the animation a frame in.
    flown.current = true
    const heading = editor.view.dom.querySelector('h1')
    if (!heading) return // nothing to fly to; the pane's own slide carries it
    const to = heading.getBoundingClientRect()
    if (!to.width || !to.height) return
    // Scale from the source's height, so the title appears to grow out of a
    // label rather than being dropped in at full size.
    const scale = Math.max(0.2, Math.min(1, flightFrom.height / to.height))
    heading.animate(
      [
        {
          transform: `translate(${flightFrom.x - to.x}px, ${
            flightFrom.y - to.y
          }px) scale(${scale})`,
          opacity: 0.3,
        },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
  }, [editor, flightFrom])

  // Wikilink decorations are derived at render time from the note list. That
  // list changes independently of the document, so nudge the view when it does —
  // otherwise a link stays "broken" until the next keystroke.
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, notes])

  // Expose the editor instance so the workspace can drive the toolbar and the
  // command palette can run formatting against the focused pane.
  useEffect(() => {
    onEditorReady(editor ?? null)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  // ---- Inline "Ask AI" on a selection ----
  const openInlineAi = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    setAiRange({ from, to, text: editor.state.doc.textBetween(from, to, '\n') })
    setAiOpen(true)
  }

  const addSelectionTask = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    onAddTask(editor.state.doc.textBetween(from, to, ' '))
  }

  const replaceSelection = (text: string) => {
    if (!editor || !aiRange) return
    editor
      .chain()
      .focus()
      .insertContentAt({ from: aiRange.from, to: aiRange.to }, text)
      .run()
    setAiOpen(false)
  }

  const insertBelowSelection = (text: string) => {
    if (!editor || !aiRange) return
    editor.chain().focus().insertContentAt(aiRange.to, `\n\n${text}`).run()
    setAiOpen(false)
  }

  return (
    <div
      className={`pane${focused ? ' focused' : ''}`}
      onMouseDown={onFocusPane}
    >
      {paneLabel && (
        <div className="pane-header">
          <span className="pane-title">{paneLabel}</span>
          {onClosePane && (
            <button
              type="button"
              className="icon-btn pane-close"
              onClick={onClosePane}
              title="Close this pane"
              aria-label="Close this pane"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {/* Sits on the pane, not the text column: clipped to the column it would
          have hard rectangular edges, which reads as a coloured box rather than
          ink soaking outward. */}
      {isNew && (
        <div className="ink-bloom" aria-hidden="true">
          <span />
        </div>
      )}

      <div className="content">
        <div
          className="editor-wrap"
          // The page enters from the direction it was travelled to: pick a tab
          // to the right and the note arrives from the right. Falls back to the
          // neutral rise when the move had no direction (a click in the tree).
          style={
            enterFrom
              ? ({
                  '--enter-x': enterFrom === 'right' ? '28px' : '-28px',
                  '--enter-y': '0px',
                } as React.CSSProperties)
              : undefined
          }
        >

          {editor && (
            <BubbleMenu
              editor={editor}
              tippyOptions={{ duration: 100, interactive: true, maxWidth: 'none' }}
              shouldShow={({ state }) => aiOpenRef.current || !state.selection.empty}
              className={`bubble-menu${aiOpen ? ' ai' : ''}`}
            >
              {aiOpen && aiRange ? (
                <InlineAssistant
                  selectedText={aiRange.text}
                  ask={onInlineAsk}
                  onReplace={replaceSelection}
                  onInsertBelow={insertBelowSelection}
                  onClose={() => setAiOpen(false)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Add as task (Ctrl/Cmd+Shift+A)"
                    aria-label="Add selection as task"
                    onClick={addSelectionTask}
                  >
                    <SquareCheckBig size={16} />
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Bookmark link in selection"
                    aria-label="Bookmark link in selection"
                    onClick={onAddBookmark}
                  >
                    <BookmarkPlus size={16} />
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn ai-trigger"
                    title="Ask AI about selection"
                    aria-label="Ask AI about selection"
                    onClick={openInlineAi}
                  >
                    <Brain size={16} />
                  </button>
                  <span className="toolbar-divider" />
                  {[...formatActions, ...listActions].map((action: FormatAction) => {
                    const { Icon, label, run, isActive } = action
                    return (
                      <button
                        key={action.name}
                        type="button"
                        className={`toolbar-btn${isActive(editor) ? ' active' : ''}`}
                        title={label}
                        aria-label={label}
                        onClick={() => run(editor)}
                      >
                        <Icon size={16} />
                      </button>
                    )
                  })}
                </>
              )}
            </BubbleMenu>
          )}

          <EditorContent editor={editor} />

          <Backlinks backlinks={backlinks} onOpenNote={onOpenNote} />
        </div>

        <Outline editor={editor} />
      </div>

      <WikilinkSuggest editor={editor} notes={notes} noteId={noteId} />
    </div>
  )
}
