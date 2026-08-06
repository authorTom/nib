import { useRef, useState } from 'react'
import { Columns2, FileText, X } from 'lucide-react'
import type { NoteFile } from '../fs/vault'

interface NoteTabsProps {
  notes: NoteFile[]
  activeId: string | null
  splitId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onReorder: (id: string, toIndex: number) => void
  onToggleSplit: () => void
  /** True when a note is dirty, so the tab can show an unsaved dot. */
  isDirty: (id: string) => boolean
}

/**
 * The open-note strip above the editor.
 *
 * Tabs are draggable to reorder, middle-clickable to close, and mark the note
 * shown in the split pane so it's obvious which tab the second pane belongs to.
 */
export default function NoteTabs({
  notes,
  activeId,
  splitId,
  onSelect,
  onClose,
  onCloseOthers,
  onReorder,
  onToggleSplit,
  isDirty,
}: NoteTabsProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  if (notes.length === 0) return null

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    // Left/right walk the strip; the tab under the cursor takes focus and opens.
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next =
      (index + (e.key === 'ArrowRight' ? 1 : -1) + notes.length) % notes.length
    onSelect(notes[next].id)
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-tab-index="${next}"]`)
      ?.focus()
  }

  return (
    <div className="tab-strip" role="tablist" aria-label="Open notes" ref={stripRef}>
      <div className="tab-strip-scroll">
        {notes.map((note, i) => {
          const active = note.id === activeId
          return (
            <div
              key={note.id}
              data-tab-index={i}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              title={note.id}
              draggable
              className={[
                'tab',
                active ? 'active' : '',
                note.id === splitId ? 'in-split' : '',
                dragId === note.id ? 'dragging' : '',
                dropIndex === i ? 'drop-before' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(note.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(note.id)
                } else {
                  onTabKeyDown(e, i)
                }
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return // middle click closes, as in a browser
                e.preventDefault()
                onClose(note.id)
              }}
              onDoubleClick={() => onCloseOthers(note.id)}
              onDragStart={(e) => {
                setDragId(note.id)
                e.dataTransfer.effectAllowed = 'move'
                // Marked as a tab move so the note tree's drop handler ignores it.
                e.dataTransfer.setData('application/x-nib-tab', note.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropIndex(null)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setDropIndex(i)
              }}
              onDrop={(e) => {
                if (!dragId) return
                e.preventDefault()
                onReorder(dragId, i)
                setDragId(null)
                setDropIndex(null)
              }}
            >
              <FileText size={14} className="tab-icon" />
              <span className="tab-label">{note.title}</span>
              {isDirty(note.id) && <span className="tab-dot" aria-label="Unsaved" />}
              <span
                className="tab-close"
                role="button"
                tabIndex={-1}
                aria-label={`Close ${note.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(note.id)
                }}
              >
                <X size={13} />
              </span>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className={`icon-btn tab-split-btn${splitId ? ' active' : ''}`}
        onClick={onToggleSplit}
        title="Split editor (Ctrl/Cmd+\)"
        aria-label="Split editor"
        aria-pressed={!!splitId}
      >
        <Columns2 size={17} />
      </button>
    </div>
  )
}
