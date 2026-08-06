/**
 * Placeholder shown while a note's bytes are still coming off disk.
 *
 * Shaped like the note it's replacing — a title and a few paragraph lines — so
 * the pane doesn't jump when the real content lands.
 */
export default function EditorSkeleton() {
  return (
    <div className="pane">
      <div className="content">
        <div className="editor-wrap skeleton-wrap" aria-hidden="true">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" style={{ width: '92%' }} />
          <div className="skeleton skeleton-line" style={{ width: '86%' }} />
          <div className="skeleton skeleton-line" style={{ width: '94%' }} />
          <div className="skeleton skeleton-line short" style={{ width: '48%' }} />
          <div className="skeleton skeleton-line" style={{ width: '90%' }} />
          <div className="skeleton skeleton-line" style={{ width: '72%' }} />
        </div>
      </div>
      <span className="visually-hidden" role="status">
        Loading note…
      </span>
    </div>
  )
}
