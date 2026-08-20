// The queue: what is waiting, what is working, and what came back.
//
// It lives inside the assistant — same panel, same composer — but it gets the
// whole panel when you look at it rather than a strip at the bottom. Two
// things are being answered here, and they need different amounts of room:
// "is anything happening?", which the ticker answers in one line while you
// carry on chatting, and "what is in the queue?", which is a list and deserves
// to be shown as one.
//
// Grouped by what you can do about a run rather than by when it arrived:
// "Needs you" is first and stays first, because a run parked on a question is
// the only kind that will never finish on its own.

import {
  AlertCircle,
  Ban,
  Check,
  ChevronRight,
  CircleDashed,
  FileText,
  Loader,
  MessageCircleQuestion,
} from 'lucide-react'
import { MAX_CONCURRENCY } from '../queue/settings'
import { modelLabel } from '../ai/models'
import type { QueueApi } from '../queue/useQueue'
import type { RunStatus, RunSummary } from '../queue/types'

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

/** The runs, split the way the view groups them. */
export function groupRuns(runs: RunSummary[]) {
  const by = (...statuses: RunStatus[]) => runs.filter((r) => statuses.includes(r.status))
  const parked = by('needs-approval', 'needs-input')
  const working = by('running')
  const pending = by('queued')
  return {
    parked,
    working,
    pending,
    failed: by('failed'),
    finished: by('succeeded', 'cancelled'),
    /** Everything still on its way somewhere — what the ticker counts. */
    live: parked.length + working.length + pending.length,
  }
}

function RunRow({
  run,
  onOpen,
  onOpenNote,
}: {
  run: RunSummary
  onOpen: () => void
  onOpenNote: (path: string) => void
}) {
  const Icon = STATUS_ICON[run.status]
  // What it actually made. A run's output is a note, so the note is the
  // output — offered here rather than only inside the run dialog, because
  // "what did it write" is the question people open a finished run to answer.
  const wrote = (run.writes ?? []).filter((w) => w.applied)

  return (
    <div className="run-entry">
      <button type="button" className={`run-row status-${run.status}`} onClick={onOpen}>
        <span className="run-icon" title={STATUS_LABEL[run.status]}>
          <Icon size={15} className={run.status === 'running' ? 'spin' : undefined} />
        </span>
        <span className="run-body">
          <span className="run-title">{run.title}</span>
          {run.summary && <span className="run-summary">{run.summary}</span>}
          {run.provider && run.model && (
            <span className="run-model">{modelLabel(run.provider, run.model)}</span>
          )}
        </span>
        <ChevronRight size={14} className="run-chevron" />
      </button>
      {wrote.length > 0 && (
        <div className="run-writes">
          {wrote.map((w) => (
            <button
              key={w.path}
              type="button"
              className="run-write"
              onClick={() => onOpenNote(w.path)}
              title={`Open ${w.path}`}
            >
              <FileText size={11} />
              {w.path.split('/').pop()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One line above the composer while chatting: enough to know the background is
 * busy, and a way through to the list. Silent when there is nothing to say.
 */
export function QueueTicker({
  queue,
  onShow,
}: {
  queue: QueueApi
  onShow: () => void
}) {
  const { parked, working, pending, failed } = groupRuns(queue.runs)
  const parts: string[] = []
  if (working.length) parts.push(`${working.length} working`)
  if (pending.length) parts.push(`${pending.length} waiting`)
  if (parked.length) parts.push(`${parked.length} needs you`)
  if (!parts.length && failed.length) parts.push(`${failed.length} didn't finish`)
  if (!parts.length) return null

  const urgent = parked.length > 0 || (!working.length && !pending.length && failed.length > 0)

  return (
    <button
      type="button"
      className={`queue-ticker${urgent ? ' urgent' : ''}`}
      onClick={onShow}
    >
      {working.length > 0 && <Loader size={12} className="spin" />}
      <span className="queue-ticker-text">{parts.join(' · ')} in the background</span>
      <span className="queue-ticker-more">View</span>
    </button>
  )
}

export default function QueueView({
  queue,
  onOpenRun,
  onOpenNote,
}: {
  queue: QueueApi
  onOpenRun: (id: string) => void
  onOpenNote: (path: string) => void
}) {
  const { parked, working, pending, failed, finished } = groupRuns(queue.runs)

  const sections: { key: string; title: string; runs: RunSummary[] }[] = [
    { key: 'parked', title: 'Needs you', runs: parked },
    { key: 'working', title: 'Working', runs: working },
    { key: 'pending', title: 'Waiting its turn', runs: pending },
    { key: 'failed', title: "Didn't finish", runs: failed },
    { key: 'finished', title: 'Finished', runs: finished.slice(0, 25) },
  ]

  return (
    <div className="queue-view">
      {/* Shown even when empty. A queue you cannot find is a queue you cannot
          trust, and "nothing here yet" is the difference between an empty
          queue and a broken one. */}
      {queue.runs.length === 0 && (
        <div className="sidebar-empty">
          Nothing queued yet.
          <span className="sidebar-empty-hint">
            Type a job below and press <strong>Queue</strong> instead of Send. It runs
            in the background while you write, and puts what it makes in{' '}
            <code>{queue.settings.inbox}</code>.
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
                <RunRow
                  key={run.id}
                  run={run}
                  onOpen={() => onOpenRun(run.id)}
                  onOpenNote={onOpenNote}
                />
              ))}
            </section>
          ),
      )}

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
    </div>
  )
}
