import { AlertTriangle, Check, X } from 'lucide-react'
import { useEnterExit } from '../hooks/useEnterExit'
import { OVERLAY_EXIT_MS } from '../lib/motion'
import type { ImportSkip } from '../lib/importMarkdown'

/**
 * Where an import has got to.
 *
 * Two phases, because they fail for different reasons and take different
 * amounts of time: reading is disk (or an archive being inflated) and can
 * surface a corrupt file; writing is the library, and can surface a revoked
 * permission or a full disk. Reporting them as one bar would put "it stalled"
 * and "it broke" behind the same picture.
 */
export interface ImportProgress {
  phase: 'reading' | 'writing'
  done: number
  total: number
  /** The file currently being read, when there is a meaningful one to name. */
  label?: string
}

export interface ImportOutcome {
  imported: number
  /** Landed under a different name because something was already there. */
  renamed: number
  skipped: ImportSkip[]
}

interface ImportModalProps {
  open: boolean
  progress: ImportProgress | null
  outcome: ImportOutcome | null
  error: string | null
  onClose: () => void
}

/** Enough to see the shape of what went wrong without scrolling all afternoon. */
const MAX_LISTED_SKIPS = 40

export default function ImportModal({
  open,
  progress,
  outcome,
  error,
  onClose,
}: ImportModalProps) {
  const anim = useEnterExit(open, OVERLAY_EXIT_MS)
  if (!anim.render) return null

  const running = progress !== null
  const close = () => {
    if (running) return // don't walk away from a half-written import
    onClose()
  }

  // Reading a drop has no total until the walk finishes, so the bar runs
  // indeterminate rather than claiming a percentage it doesn't know.
  const known = !!progress && progress.total > 0
  const percent =
    progress && known ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

  const listed = outcome?.skipped.slice(0, MAX_LISTED_SKIPS) ?? []
  const overflow = (outcome?.skipped.length ?? 0) - listed.length

  return (
    <div
      className={`modal-overlay${anim.entered ? ' entered' : ''}`}
      onMouseDown={close}
    >
      <div
        className={`modal${anim.entered ? ' entered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Import notes"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Import notes</span>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            disabled={running}
            title="Close"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {running && (
            <div className="import-progress">
              <div className="import-progress-head">
                <span>
                  {progress.phase === 'reading'
                    ? 'Reading files…'
                    : 'Writing notes into your library…'}
                </span>
                {known && (
                  <span className="import-progress-count">
                    {progress.done} / {progress.total}
                  </span>
                )}
              </div>

              <div
                className={`progress-track${known ? '' : ' indeterminate'}`}
                role="progressbar"
                aria-label={
                  progress.phase === 'reading' ? 'Reading files' : 'Writing notes'
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={known ? percent : undefined}
              >
                <div
                  className="progress-fill"
                  style={known ? { transform: `scaleX(${percent / 100})` } : undefined}
                />
              </div>

              {progress.label && (
                <div className="import-progress-file" title={progress.label}>
                  {progress.label}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="import-result import-result-error" role="alert">
              <AlertTriangle size={16} />
              <div>
                <strong>The import stopped.</strong>
                <div className="import-result-detail">{error}</div>
                <div className="import-result-detail">
                  Anything already written is in your library and was not undone.
                </div>
              </div>
            </div>
          )}

          {outcome && !error && (
            <>
              <div
                className={`import-result${
                  outcome.imported ? ' import-result-done' : ''
                }`}
                role="status"
              >
                {outcome.imported ? <Check size={16} /> : <AlertTriangle size={16} />}
                <div>
                  <strong>
                    {outcome.imported
                      ? `Imported ${outcome.imported} note${
                          outcome.imported === 1 ? '' : 's'
                        }`
                      : 'Nothing was imported'}
                  </strong>
                  {outcome.renamed > 0 && (
                    <div className="import-result-detail">
                      {outcome.renamed} landed under a new name — a note of that
                      name was already there, and nothing is ever overwritten.
                    </div>
                  )}
                  {!outcome.imported && !outcome.skipped.length && (
                    <div className="import-result-detail">
                      There were no Markdown files in that selection.
                    </div>
                  )}
                </div>
              </div>

              {outcome.skipped.length > 0 && (
                <div className="import-skips">
                  <div className="import-skips-title">
                    {outcome.skipped.length} file
                    {outcome.skipped.length === 1 ? '' : 's'} skipped
                  </div>
                  <ul className="import-skip-list">
                    {listed.map((skip) => (
                      <li key={`${skip.name}:${skip.reason}`} className="import-skip">
                        <span className="import-skip-name" title={skip.name}>
                          {skip.name}
                        </span>
                        <span className="import-skip-reason">{skip.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {overflow > 0 && (
                    <div className="import-skips-more">
                      …and {overflow} more.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={close}
            disabled={running}
          >
            {running ? 'Importing…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
