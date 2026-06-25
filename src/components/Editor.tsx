import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, BubbleMenu, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { Brain } from 'lucide-react'
import TopBar from './TopBar'
import Toolbar from './Toolbar'
import InlineAssistant from './InlineAssistant'
import { formatActions, listActions, type FormatAction } from './formatActions'
import { downloadMarkdown } from '../lib/exportMarkdown'
import { exportToPdf } from '../lib/exportPdf'
import type { Theme } from '../hooks/useTheme'

interface WorkspaceProps {
  title: string
  content: string
  onContentChange: (markdown: string) => void
  onTitleCommit: (title: string) => void
  onNew: () => void
  onToggleSidebar: () => void
  onToggleFocus: () => void
  onOpenPalette: () => void
  onOpenAssistant: () => void
  onInlineAsk: (
    instruction: string,
    selectedText: string,
    signal: AbortSignal,
  ) => Promise<string>
  onEditorReady: (editor: TiptapEditor | null) => void
  theme: Theme
  onToggleTheme: () => void
}

export default function Editor({
  title,
  content,
  onContentChange,
  onTitleCommit,
  onNew,
  onToggleSidebar,
  onToggleFocus,
  onOpenPalette,
  onOpenAssistant,
  onInlineAsk,
  onEditorReady,
  theme,
  onToggleTheme,
}: WorkspaceProps) {
  const [aiOpen, setAiOpen] = useState(false)
  const [aiRange, setAiRange] = useState<{ from: number; to: number; text: string } | null>(null)
  // Read inside the bubble-menu shouldShow (which may capture a stale closure).
  const aiOpenRef = useRef(false)
  aiOpenRef.current = aiOpen
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Markdown.configure({ linkify: true, breaks: true, transformPastedText: true }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      onContentChange(editor.storage.markdown.getMarkdown())
    },
  })

  // Parse the markdown content into the editor once it's ready. This component
  // is remounted per note (keyed by id in App), so this runs for each note.
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(content, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Expose the editor instance so the command palette can run formatting.
  useEffect(() => {
    onEditorReady(editor ?? null)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  const handleSaveMarkdown = () => {
    if (!editor) return
    downloadMarkdown(title, editor.storage.markdown.getMarkdown())
  }

  // ---- Inline "Ask AI" on a selection ----
  const openInlineAi = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    setAiRange({ from, to, text: editor.state.doc.textBetween(from, to, '\n') })
    setAiOpen(true)
  }

  const replaceSelection = (text: string) => {
    if (!editor || !aiRange) return
    editor.chain().focus().insertContentAt({ from: aiRange.from, to: aiRange.to }, text).run()
    setAiOpen(false)
  }

  const insertBelowSelection = (text: string) => {
    if (!editor || !aiRange) return
    editor.chain().focus().insertContentAt(aiRange.to, `\n\n${text}`).run()
    setAiOpen(false)
  }

  return (
    <div className="main">
      <TopBar
        title={title}
        onTitleCommit={onTitleCommit}
        onNew={onNew}
        onSaveMarkdown={handleSaveMarkdown}
        onExportPdf={() => exportToPdf(title)}
        onToggleSidebar={onToggleSidebar}
        onToggleFocus={onToggleFocus}
        onOpenPalette={onOpenPalette}
        onOpenAssistant={onOpenAssistant}
        theme={theme}
        onToggleTheme={onToggleTheme}
        hasNote
      />

      {editor && <Toolbar editor={editor} />}

      <div className="content">
        <div className="editor-wrap">
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
        </div>
      </div>
    </div>
  )
}
