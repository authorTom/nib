import { RotateCcw, Trash2, X } from 'lucide-react'
import type { TrashItem } from '../fs/vault'

interface TrashModalProps {
  open: boolean
  items: TrashItem[]
  onClose: () => void
  onRestore: (trashName: string) => void
  onDeleteForever: (trashName: string) => void
  onEmpty: () => void
}

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
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

export default function TrashModal({
  open,
  items,
  onClose,
  onRestore,
  onDeleteForever,
  onEmpty,
}: TrashModalProps) {
  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Recycle Bin</span>
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
            <div className="modal-empty">The recycle bin is empty.</div>
          ) : (
            items.map((item) => {
              const folder = folderOf(item.originalPath)
              return (
                <div key={item.trashName} className="trash-row">
                  <div className="trash-info">
                    <span className="trash-title">{item.title}</span>
                    <span className="trash-meta">
                      {folder ? `${folder} · ` : ''}
                      deleted {timeAgo(item.deletedAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onRestore(item.trashName)}
                    title="Restore"
                    aria-label="Restore"
                  >
                    <RotateCcw size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn trash-danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Permanently delete "${item.title}"? This cannot be undone.`,
                        )
                      ) {
                        onDeleteForever(item.trashName)
                      }
                    }}
                    title="Delete permanently"
                    aria-label="Delete permanently"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (
                window.confirm(
                  'Permanently delete all items in the recycle bin? This cannot be undone.',
                )
              ) {
                onEmpty()
              }
            }}
            disabled={items.length === 0}
          >
            <Trash2 size={15} />
            Empty bin
          </button>
        </div>
      </div>
    </div>
  )
}
