// One run, in full: what it was asked, what it did, and whatever it is waiting
// for. Wide enough for a diff, because the thing you are most often here to do
// is decide whether to let a change through.

import { useCallback, useEffect, useState } from 'react'
import {
  Ban,
  FileText,
  RotateCcw,
  Play,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { useEnterExit } from '../hooks/useEnterExit'
import { OVERLAY_EXIT_MS } from '../lib/motion'
import { ApprovalCard } from './ApprovalCard'
import { FINISHED, type Run } from '../queue/types'
import type { QueueApi } from '../queue/useQueue'

interface RunModalProps {
  /** Which run to show; null closes the dialog. */
  runId: string | null
  queue: QueueApi
  onClose: () => void
  onOpenNote: (path: string) => void
}

export default function RunModal({
  runId,
  queue,
  onClose,
  onOpenNote,
}: RunModalProps) {
  const anim = useEnterExit(runId !== null, OVERLAY_EXIT_MS)
  const [run, setRun] = useState<Run | null>(null)
  const [answer, setAnswer] = useState('')

  const load = useCallback(async () => {
    if (!runId) return
    setRun(await queue.open(runId))
  }, [runId, queue])

  useEffect(() => {
    void load()
  }, [load])

  // The panel's list is refreshed on every turn, so following it keeps this
  // view live while a run works rather than freezing at whatever it said when
  // it was opened.
  useEffect(() => {
    if (!runId) return
    void load()
  }, [queue.runs, runId, load])

  useEffect(() => {
    if (!runId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [runId, onClose])

  if (!anim.render || !run) return null

  const finished = FINISHED.includes(run.status)
  const parked = run.status === 'needs-approval' || run.status === 'needs-input'

  const sendAnswer = () => {
    const text = answer.trim()
    if (!text) return
    setAnswer('')
    void queue.reply(run.id, text)
  }

  return (
    <div
      className={`modal-overlay${anim.entered ? ' entered' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal run-modal${anim.entered ? ' entered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={run.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title run-modal-title">{run.title}</span>
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

        <div className="modal-body run-body">
          {/* The title is the prompt's first line, trimmed. Repeating it in
              full underneath is only worth the space when there is more of it
              than the header already showed. */}
          {run.prompt.trim() !== run.title && (
            <p className="run-prompt">{run.prompt}</p>
          )}

          {run.status === 'needs-input' && run.question && (
            <div className="run-question">
              <p className="run-question-text">{run.question}</p>
              <div className="run-answer">
                <textarea
                  className="run-answer-input"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      sendAnswer()
                    }
                  }}
                  rows={2}
                  autoFocus
                  placeholder="Your answer…"
                  aria-label="Answer the assistant"
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={sendAnswer}
                  disabled={!answer.trim()}
                >
                  <Send size={14} />
                  Reply
                </button>
              </div>
            </div>
          )}

          {run.status === 'needs-approval' && run.pendingPreview && (
            <ApprovalCard
              action={{
                id: run.id,
                toolName: run.pendingCalls?.[0]?.name ?? '',
                preview: run.pendingPreview,
                status: 'pending',
              }}
              onApprove={() => void queue.decide(run.id, true)}
              onReject={() => void queue.decide(run.id, false)}
            />
          )}

          {run.error && (
            <div className="run-error" role="alert">
              {run.error}
            </div>
          )}

          {run.writes.length > 0 && (
            <div className="run-writes">
              <h3 className="run-section-title">Notes it wrote</h3>
              {run.writes.map((write, i) => (
                <button
                  key={`${write.path}-${i}`}
                  type="button"
                  className="run-write"
                  onClick={() => {
                    onOpenNote(write.path)
                    onClose()
                  }}
                >
                  <FileText size={14} />
                  <span className="run-write-path">{write.path}</span>
                  <span className="run-write-kind">{write.kind}</span>
                </button>
              ))}
            </div>
          )}

          {run.summary && !parked && (
            <div className="run-outcome">
              <h3 className="run-section-title">Summary</h3>
              <p>{run.summary}</p>
            </div>
          )}

          <details className="run-transcript">
            <summary>Transcript ({run.messages.length} messages)</summary>
            {run.messages.map((message) => (
              <div key={message.id} className={`run-message role-${message.role}`}>
                <span className="run-message-role">
                  {message.role === 'tool' ? message.toolName : message.role}
                </span>
                <span className="run-message-body">
                  {message.content || (message.toolCalls?.length
                    ? `(calling ${message.toolCalls.map((c) => c.name).join(', ')})`
                    : '')}
                </span>
              </div>
            ))}
          </details>
        </div>

        <div className="modal-footer run-footer">
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              void queue.remove(run.id)
              onClose()
            }}
          >
            <Trash2 size={14} />
            Delete
          </button>
          <span className="run-footer-spacer" />
          {!finished && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => void queue.cancel(run.id)}
            >
              <Ban size={14} />
              Cancel
            </button>
          )}
          {/* Offered for anything that stopped short, including a run that was
              interrupted before its first reply — that one has no transcript to
              carry, but resuming is still the right verb and still the right
              button, and gating on transcript length hid it exactly when the
              run most needed picking back up. */}
          {(run.status === 'failed' || run.status === 'cancelled') && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => void queue.resume(run.id)}
              title="Carry on from where it stopped, keeping what it has already done"
            >
              <Play size={14} />
              Resume
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => void queue.rerun(run.id)}
            title="Start again from the original instruction, as a new run"
          >
            <RotateCcw size={14} />
            Run again
          </button>
        </div>
      </div>
    </div>
  )
}
