import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw, Trash2, X } from 'lucide-react'
import type { HistoryItem, SnapshotReason } from '../fs/history'

interface HistoryModalProps {
  open: boolean
  noteTitle: string
  items: HistoryItem[]
  onClose: () => void
  onRestore: (snapName: string) => void
  onDelete: (snapName: string) => void
  /** Lazily load a snapshot's content for the preview pane. */
  loadContent: (snapName: string) => Promise<string>
}

const REASON_LABEL: Record<SnapshotReason, string> = {
  edit: 'while editing',
  ai: 'before AI edit',
  restore: 'before restore',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function HistoryModal({
  open,
  noteTitle,
  items,
  onClose,
  onRestore,
  onDelete,
  loadContent,
}: HistoryModalProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})

  // Start collapsed each time the modal opens (likely a different note).
  useEffect(() => {
    if (open) {
      setExpanded(null)
      setContents({})
    }
  }, [open])

  if (!open) return null

  const toggle = (snapName: string) => {
    if (expanded === snapName) {
      setExpanded(null)
      return
    }
    setExpanded(snapName)
    if (contents[snapName] === undefined) {
      void loadContent(snapName).then((text) =>
        setContents((c) => ({ ...c, [snapName]: text })),
      )
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">History — {noteTitle}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {items.length === 0 ? (
            <div className="modal-empty">
              No earlier versions yet. Versions are saved periodically while you
              edit and before every AI change.
            </div>
          ) : (
            items.map((item) => {
              const isOpen = expanded === item.snapName
              return (
                <div key={item.snapName} className="history-item">
                  <div className="trash-row">
                    <button
                      type="button"
                      className="history-toggle"
                      onClick={() => toggle(item.snapName)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? 'Hide preview' : 'Show preview'}
                    >
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <span className="trash-info">
                        <span className="trash-title">{timeAgo(item.savedAt)}</span>
                        <span className="trash-meta">
                          {new Date(item.savedAt).toLocaleString()} ·{' '}
                          {REASON_LABEL[item.reason]}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onRestore(item.snapName)}
                      title="Restore this version"
                      aria-label="Restore this version"
                    >
                      <RotateCcw size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn trash-danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Delete this version permanently? This cannot be undone.',
                          )
                        ) {
                          onDelete(item.snapName)
                        }
                      }}
                      title="Delete this version"
                      aria-label="Delete this version"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {isOpen && (
                    <pre className="history-preview">
                      {contents[item.snapName] === undefined
                        ? 'Loading…'
                        : contents[item.snapName] || '(empty)'}
                    </pre>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
