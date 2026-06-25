import { useEffect } from 'react'
import { useEditor, EditorContent, BubbleMenu, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import TopBar from './TopBar'
import Toolbar from './Toolbar'
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
  onEditorReady,
  theme,
  onToggleTheme,
}: WorkspaceProps) {
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
              tippyOptions={{ duration: 100 }}
              className="bubble-menu"
            >
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
            </BubbleMenu>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
