import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface Heading {
  level: number
  text: string
  pos: number
}

/** Read every heading out of the live document, in order. */
function collectHeadings(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const text = node.textContent.trim()
    if (text) out.push({ level: node.attrs.level as number, text, pos })
  })
  return out
}

/**
 * Document outline, docked in the editor's right gutter.
 *
 * Tracks the live document rather than the saved markdown, so a heading typed a
 * moment ago is already navigable. Hidden entirely for short notes, where a
 * table of contents is just noise.
 */
export default function Outline({ editor }: { editor: Editor | null }) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activePos, setActivePos] = useState<number | null>(null)

  useEffect(() => {
    if (!editor) return
    const sync = () => setHeadings(collectHeadings(editor))
    sync()
    editor.on('update', sync)
    return () => {
      editor.off('update', sync)
    }
  }, [editor])

  // Highlight the heading the cursor currently sits under.
  useEffect(() => {
    if (!editor) return
    const sync = () => {
      const from = editor.state.selection.from
      let current: number | null = null
      for (const h of collectHeadings(editor)) {
        if (h.pos <= from) current = h.pos
        else break
      }
      setActivePos(current)
    }
    sync()
    editor.on('selectionUpdate', sync)
    return () => {
      editor.off('selectionUpdate', sync)
    }
  }, [editor])

  if (!editor || headings.length < 2) return null

  const goTo = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).run()
    const dom = editor.view.domAtPos(pos + 1).node as HTMLElement | Text
    const el = dom instanceof HTMLElement ? dom : dom.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <nav className="outline" aria-label="Document outline">
      <div className="outline-title">On this page</div>
      {headings.map((h) => (
        <button
          key={`${h.pos}-${h.text}`}
          type="button"
          className={`outline-item level-${h.level}${
            h.pos === activePos ? ' active' : ''
          }`}
          onClick={() => goTo(h.pos)}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </nav>
  )
}
