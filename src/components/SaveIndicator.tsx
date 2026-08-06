import { useEffect, useState } from 'react'
import type { SaveState } from '../hooks/useNotes'
import { timeAgo } from '../lib/format'

interface SaveIndicatorProps {
  state: SaveState
  lastSavedAt: number | null
}

/**
 * Quiet confirmation that the debounced writer has reached the disk.
 *
 * Nib writes to the user's own files, so "did that save?" deserves an answer
 * that doesn't require opening the folder.
 */
export default function SaveIndicator({ state, lastSavedAt }: SaveIndicatorProps) {
  // "Saved 2m ago" has to keep counting while the user reads it.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (state !== 'saved' || !lastSavedAt) return
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [state, lastSavedAt])

  if (state === 'idle') return null

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
