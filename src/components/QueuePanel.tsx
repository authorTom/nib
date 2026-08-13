// The queue: what the assistant is working on, and what it needs from you.
//
// Grouped by what you can do about a run rather than by when it arrived.
// "Needs you" is first and stays first, because a run parked on a question is
// the only kind that will never finish on its own.

import { useState } from 'react'
import {
  AlertCircle,
  Ban,
  Check,
  ChevronRight,
  CircleDashed,
  Loader,
  MessageCircleQuestion,
  Plus,
} from 'lucide-react'
import { MAX_CONCURRENCY } from '../queue/settings'
import type { QueueApi } from '../queue/useQueue'
import type { RunStatus, RunSummary } from '../queue/types'

interface QueuePanelProps {
  queue: QueueApi
  /** Path of the note open in the editor, attached to whatever is queued. */
  activePath: string | null
  onOpenRun: (id: string) => void
  /** Assistant isn't configured — queueing would fail on the first call. */
  ready: boolean
}

const STATUS_ICON: Record<RunStatus, typeof Check> = {
  queued: CircleDashed,
  running: Loader,
  'needs-approval': AlertCircle,
  'needs-input': MessageCircleQuestion,
  succeeded: Check,
  failed: AlertCircle,
  cancelled: Ban,
}

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Waiting its turn',
  running: 'Working',
  'needs-approval': 'Needs approval',
  'needs-input': 'Asked you a question',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function RunRow({
  run,
  onOpen,
}: {
  run: RunSummary
  onOpen: () => void
}) {
  const Icon = STATUS_ICON[run.status]
  return (
    <button type="button" className={`run-row status-${run.status}`} onClick={onOpen}>
      <span className="run-icon" title={STATUS_LABEL[run.status]}>
        <Icon size={15} className={run.status === 'running' ? 'spin' : undefined} />
      </span>
      <span className="run-body">
        <span className="run-title">{run.title}</span>
        {run.summary && <span className="run-summary">{run.summary}</span>}
      </span>
      <ChevronRight size={14} className="run-chevron" />
    </button>
  )
}

export default function QueuePanel({
  queue,
  activePath,
  onOpenRun,
  ready,
}: QueuePanelProps) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void queue.enqueue(text, activePath ?? undefined)
  }

  const waiting = queue.runs.filter(
    (r) => r.status === 'needs-approval' || r.status === 'needs-input',
  )
  const active = queue.runs.filter((r) => r.status === 'running')
  const pending = queue.runs.filter((r) => r.status === 'queued')
  const done = queue.runs.filter(
    (r) => r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled',
  )

  const sections: { key: string; title: string; runs: RunSummary[] }[] = [
    { key: 'waiting', title: 'Needs you', runs: waiting },
    { key: 'running', title: 'Working', runs: active },
    { key: 'queued', title: 'Waiting its turn', runs: pending },
    { key: 'done', title: 'Finished', runs: done.slice(0, 25) },
  ]

  return (
    <div className="queue-panel">
      <div className="queue-compose">
        <textarea
          className="queue-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={
            ready
              ? 'Give the assistant a job — it runs in the background and puts the result in your inbox folder.'
              : 'Set up a provider in the assistant panel first.'
          }
          rows={3}
          disabled={!ready}
          aria-label="Queue a job for the assistant"
        />
        <div className="queue-compose-actions">
          <label className="queue-concurrency">
            <span>Run</span>
            <select
              value={queue.settings.concurrency}
              onChange={(e) => queue.updateSettings({ concurrency: Number(e.target.value) })}
              aria-label="How many runs at once"
            >
              {Array.from({ length: MAX_CONCURRENCY }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 at a time' : `${n} at a time`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary queue-submit"
            onClick={submit}
            disabled={!ready || !draft.trim()}
          >
            <Plus size={15} />
            Queue
          </button>
        </div>
      </div>

      <div className="queue-list">
        {queue.runs.length === 0 && (
          <div className="sidebar-empty">
            Nothing queued.
            <span className="sidebar-empty-hint">
              Queued jobs run in the background and write into{' '}
              <code>{queue.settings.inbox}</code>. Anything outside it stops and
              asks you first.
            </span>
          </div>
        )}

        {sections.map(
          (section) =>
            section.runs.length > 0 && (
              <section key={section.key} className="queue-group">
                <h3 className="queue-group-title">
                  {section.title}
                  <span className="queue-group-count">{section.runs.length}</span>
                </h3>
                {section.runs.map((run) => (
                  <RunRow key={run.id} run={run} onOpen={() => onOpenRun(run.id)} />
                ))}
              </section>
            ),
        )}
      </div>
    </div>
  )
}
