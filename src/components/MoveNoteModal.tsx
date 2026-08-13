import { useEffect, useState } from 'react'
import { FolderInput, X } from 'lucide-react'
import FolderPicker from './FolderPicker'
import { useEnterExit } from '../hooks/useEnterExit'
import { OVERLAY_EXIT_MS } from '../lib/motion'
import type { TreeNode } from '../fs/library'

interface MoveNoteModalProps {
  open: boolean
  /** Title of the note being moved, for the sentence at the top. */
  noteTitle: string
  /** Folder it is in now ("" = the library root). */
  currentFolder: string
  tree: TreeNode[]
  libraryName: string | null
  onMove: (targetFolder: string) => void
  onClose: () => void
}

/**
 * Moving one note to another folder, without dragging it there.
 *
 * Drag and drop is quick when both ends are on screen; it is miserable when the
 * destination is three folders down and collapsed, or when the tree is longer
 * than the window. This is the same operation, said in words.
 */
export default function MoveNoteModal({
  open,
  noteTitle,
  currentFolder,
  tree,
  libraryName,
  onMove,
  onClose,
}: MoveNoteModalProps) {
  const anim = useEnterExit(open, OVERLAY_EXIT_MS)
  const [target, setTarget] = useState(currentFolder)
  // The note is forgotten the moment the dialog closes, so the last one is held
  // to render against while it animates out — otherwise it leaves as a dialog
  // about nothing.
  const [shown, setShown] = useState({ noteTitle, currentFolder })

  // Each opening starts from where the note already is, so the dialog opens
  // showing the truth rather than a stale answer from the last note moved.
  useEffect(() => {
    if (!open) return
    setShown({ noteTitle, currentFolder })
    setTarget(currentFolder)
  }, [open, noteTitle, currentFolder])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!anim.render) return null

  const unchanged = target === shown.currentFolder
  const submit = () => {
    if (unchanged) return
    onMove(target)
    onClose()
  }

  return (
    <div
      className={`modal-overlay${anim.entered ? ' entered' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal${anim.entered ? ' entered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${shown.noteTitle}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Move note</span>
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
          <p className="modal-note">
            Move <strong>{shown.noteTitle}</strong> from{' '}
            <strong>{shown.currentFolder || libraryName || 'the library root'}</strong>{' '}
            to:
          </p>
          <FolderPicker
            tree={tree}
            rootLabel={libraryName ?? 'Library root'}
            value={target}
            onChange={setTarget}
            currentPath={shown.currentFolder}
            onSubmit={submit}
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={unchanged}
            title={unchanged ? 'That is where the note already is' : undefined}
          >
            <FolderInput size={15} />
            Move here
          </button>
        </div>
      </div>
    </div>
  )
}
