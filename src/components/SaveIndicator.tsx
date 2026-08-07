import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { SaveState } from '../hooks/useNotes'
import { timeAgo } from '../lib/format'

interface SaveIndicatorProps {
  state: SaveState
  lastSavedAt: number | null
  /** Plain-language reason the last write failed, when it did. */
  error?: string | null
}

/**
 * Quiet confirmation that the debounced writer has reached the disk.
 *
 * Nib writes to the user's own files, so "did that save?" deserves an answer
 * that doesn't require opening the folder. Quiet is right for the three states
 * that are working as intended — and wrong for the fourth, so a failed write
 * breaks the whisper and says what to do about it.
 */
export default function SaveIndicator({
  state,
  lastSavedAt,
  error,
}: SaveIndicatorProps) {
  // "Saved 2m ago" has to keep counting while the user reads it.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (state !== 'saved' || !lastSavedAt) return
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [state, lastSavedAt])

  if (state === 'idle') return null

  // The failure is the one state that gets a word, an icon and a colour: it is
  // also the only one the user has to act on. `alert` rather than `status`, so
  // a screen reader interrupts instead of waiting for a gap.
  if (state === 'error') {
    const message = error ?? "Couldn't save to your vault."
    return (
      <span className="save-indicator error" role="alert" title={message}>
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="save-label">Not saved</span>
        <span className="visually-hidden">{message}</span>
      </span>
    )
  }

  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'unsaved'
        ? 'Unsaved changes'
        : lastSavedAt
          ? `Saved ${timeAgo(lastSavedAt)}`
          : 'Saved'

  return (
    <span
      className={`save-indicator ${state}`}
      role="status"
      aria-live="polite"
      title={label}
    >
      <span className="save-dot" aria-hidden="true" />
      <span className="save-label">{label}</span>
    </span>
  )
}
