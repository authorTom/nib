// The approval card and its diff, shared by the chat panel and the queue.
//
// A queued run parks on the same question the chat asks — "may I write this?" —
// and answering it deserves the same picture. Lifted out of AssistantPanel when
// the queue arrived rather than copied, because two diff renderers drift and
// the one thing a diff must never do is disagree with itself.

import { useMemo } from 'react'
import { Check, FileEdit, X } from 'lucide-react'
import { diffLines, type DiffLine } from '../lib/diff'
import type { PendingAction } from '../ai/useAssistant'

/** Longest diff we'll put in the DOM; past this the reader is scrolling, not reading. */
const MAX_DIFF_LINES = 400

export function ApprovalDiff({
  before,
  after,
}: {
  before: string
  after: string
}) {
  const diff = useMemo(() => diffLines(before, after), [before, after])

  if (!before.trim()) {
    const lines = after.replace(/\n$/, '').split('\n')
    const shown = lines.slice(0, MAX_DIFF_LINES)
    return (
      <div className="approval-diff">
        <div className="diff-stat">
          <span className="diff-added">+{lines.length}</span> lines · new file
        </div>
        <pre className="diff-body">
          {shown.map((text, i) => (
            <span key={i} className="diff-line add">
              <span className="diff-mark" aria-hidden="true">
                +
              </span>
              <span className="diff-text">{text || ' '}</span>
            </span>
          ))}
        </pre>
        {lines.length > shown.length && (
          <div className="diff-more">
            {lines.length - shown.length} more lines not shown
          </div>
        )}
      </div>
    )
  }

  if (diff.identical) {
    return (
      <div className="approval-diff">
        <div className="diff-stat">No change — the file already reads this way.</div>
      </div>
    )
  }

  // Flatten hunks for rendering, keeping the "N unchanged lines" separators.
  const rows: { key: string; line?: DiffLine; skipped?: number }[] = []
  let budget = MAX_DIFF_LINES
  let dropped = 0
  diff.hunks.forEach((hunk, h) => {
    if (hunk.skipped > 0) {
      rows.push({ key: `s${h}`, skipped: hunk.skipped })
    }
    hunk.lines.forEach((line, i) => {
      if (budget > 0) {
        rows.push({ key: `${h}-${i}`, line })
        budget--
      } else {
        dropped++
      }
    })
  })

  return (
    <div className="approval-diff">
      <div className="diff-stat">
        <span className="diff-added">+{diff.added}</span>{' '}
        <span className="diff-removed">−{diff.removed}</span> lines
        {diff.coarse && ' · replaced wholesale'}
      </div>
      <pre className="diff-body">
        {rows.map((row) =>
          row.line ? (
            <span key={row.key} className={`diff-line ${row.line.kind}`}>
              <span className="diff-mark" aria-hidden="true">
                {row.line.kind === 'add'
                  ? '+'
                  : row.line.kind === 'remove'
                    ? '−'
                    : ' '}
              </span>
              <span className="diff-text">{row.line.text || ' '}</span>
            </span>
          ) : (
            <span key={row.key} className="diff-skip">
              ⋯ {row.skipped} unchanged {row.skipped === 1 ? 'line' : 'lines'}
            </span>
          ),
        )}
      </pre>
      {dropped > 0 && (
        <div className="diff-more">{dropped} more changed lines not shown</div>
      )}
    </div>
  )
}

export function ApprovalCard({
  action,
  onApprove,
  onReject,
}: {
  action: PendingAction
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const decided = action.status !== 'pending'
  return (
    <div className={`approval-card status-${action.status}`}>
      <div className="approval-head">
        <FileEdit size={15} />
        <span className="approval-summary">{action.preview.summary}</span>
      </div>
      {action.preview.kind === 'write' && (
        <ApprovalDiff
          before={action.preview.before ?? ''}
          after={action.preview.after ?? ''}
        />
      )}
      {!decided ? (
        <div className="approval-actions">
          <button className="btn-approve" onClick={() => onApprove(action.id)}>
            <Check size={14} /> Approve
          </button>
          <button className="btn-reject" onClick={() => onReject(action.id)}>
            <X size={14} /> Reject
          </button>
        </div>
      ) : (
        <div className={`approval-result ${action.status}`}>
          {action.status === 'approved' ? 'Approved' : 'Rejected'}
        </div>
      )}
    </div>
  )
}
