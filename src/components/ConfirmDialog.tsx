import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useEnterExit } from '../hooks/useEnterExit'

/** Keep in step with --dur-base in theme.css. */
const TRANSITION_MS = 180

export interface ConfirmRequest {
  title: string
  /** Supporting sentence under the title. */
  body?: string
  /** Label for the affirmative button. */
  confirmLabel: string
  /** Style the affirmative button as destructive. */
  danger?: boolean
  onConfirm: () => void
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null
  onClose: () => void
}

/**
 * The styled replacement for `window.confirm`.
 *
 * Rendered from a single request object held by App, so any caller can raise a
 * confirmation without threading its own open/close state through the tree.
 */
export default function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const { render, entered } = useEnterExit(request !== null, TRANSITION_MS)
  // The request is cleared the moment the dialog closes, so hold the last one
  // to render against while it animates out.
  const [shown, setShown] = useState(request)
  useEffect(() => {
    if (request) setShown(request)
  }, [request])

  // Focus the affirmative button, so Enter confirms and Escape cancels without
  // the user having to reach for the mouse.
  useEffect(() => {
    if (request) requestAnimationFrame(() => confirmRef.current?.focus())
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request, onClose])

  if (!render || !shown) return null

  const confirm = () => {
    shown.onConfirm()
    onClose()
  }

  return (
    <div
      className={`modal-overlay confirm-overlay${entered ? ' entered' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal confirm-dialog${entered ? ' entered' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={shown.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-body">
          {shown.danger && (
            <span className="confirm-icon" aria-hidden="true">
              <AlertTriangle size={20} />
            </span>
          )}
          <div>
            <h2 className="confirm-title">{shown.title}</h2>
            {shown.body && <p className="confirm-text">{shown.body}</p>}
          </div>
        </div>
        <div className="confirm-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={shown.danger ? 'btn-danger' : 'btn-primary'}
            onClick={confirm}
          >
            {shown.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
