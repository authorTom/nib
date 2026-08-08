import { useEffect, useRef, useState } from 'react'
import { Check, FileText, MessageSquare, Repeat, Trash2 } from 'lucide-react'
import { dueChipLabel, todayStr } from '../tasks/dates'
import { timeAgo } from '../lib/format'
import type { Priority, Project, RecurrenceFreq, Task } from '../tasks/types'

interface TaskItemProps {
  task: Task
  projects: Project[]
  /** Show the project chip (hidden when already inside that project's view). */
  showProject?: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<Task>) => void
  onDelete: () => void
  onOpenNote: (noteId: string) => void
  /** Append a free-text update. */
  onAddComment: (body: string) => void
  onDeleteComment: (commentId: string) => void
}

const INTERVAL_UNIT: Record<RecurrenceFreq, string> = {
  daily: 'day(s)',
  weekly: 'week(s)',
  monthly: 'month(s)',
  yearly: 'year(s)',
}

export default function TaskItem({
  task,
  projects,
  showProject = true,
  onToggle,
  onUpdate,
  onDelete,
  onOpenNote,
  onAddComment,
  onDeleteComment,
}: TaskItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  // Ticking a task usually removes it from the list it's in. Hold it in place
  // for the length of the animation so the check has time to draw and the row
  // has time to collapse, rather than the item just blinking out.
  const [completing, setCompleting] = useState(false)
  const completeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(completeTimer.current), [])

  const project = task.projectId
    ? projects.find((p) => p.id === task.projectId)
    : undefined
  const today = todayStr()
  const done = !!task.completedAt
  const overdue = !!task.due && !done && task.due < today

  const comments = task.comments ?? []

  const handleToggle = () => {
    if (done || completing) {
      onToggle()
      return
    }
    setCompleting(true)
    completeTimer.current = setTimeout(onToggle, 320)
  }

  const postComment = () => {
    if (!draft.trim()) return
    onAddComment(draft)
    setDraft('')
  }

  return (
    <div
      className={`task-item${done ? ' done' : ''}${completing ? ' completing' : ''}`}
    >
      <div className="task-row">
        <button
          type="button"
          className={`task-check p${task.priority}`}
          onClick={handleToggle}
          title={
            done ? 'Reopen' : task.recurrence ? 'Complete (repeats)' : 'Complete'
          }
          aria-label={done ? 'Reopen task' : 'Complete task'}
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          className="task-main"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          <span className="task-title">{task.title}</span>
          {(task.due ||
            task.recurrence ||
            comments.length > 0 ||
            (showProject && project)) && (
            <span className="task-meta">
              {task.due && (
                <span
                  className={`task-due${overdue ? ' overdue' : ''}${
                    task.due === today && !overdue ? ' today' : ''
                  }`}
                >
                  {dueChipLabel(task.due)}
                </span>
              )}
              {task.recurrence && <Repeat size={11} aria-label="Repeats" />}
              {comments.length > 0 && (
                <span
                  className="task-comment-count"
                  title={`${comments.length} update${
                    comments.length === 1 ? '' : 's'
                  }`}
                >
                  <MessageSquare size={11} aria-hidden="true" />
                  {comments.length}
                </span>
              )}
              {showProject && project && (
                <span className="task-project">
                  <span
                    className="task-project-dot"
                    style={{ background: project.color }}
                  />
                  {project.name}
                </span>
              )}
            </span>
          )}
        </button>
        {task.source && (
          <button
            type="button"
            className="icon-btn task-action"
            title={`Open note: ${task.source.noteId}`}
            aria-label="Open source note"
            onClick={() => onOpenNote(task.source!.noteId)}
          >
            <FileText size={15} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn task-action trash-danger"
          title="Delete task"
          aria-label="Delete task"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="task-edit">
          <input
            className="task-edit-title"
            value={task.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            aria-label="Task title"
          />
          <div className="task-edit-grid">
            <label>
              Due
              <input
                type="date"
                value={task.due ?? ''}
                onChange={(e) => onUpdate({ due: e.target.value || null })}
              />
            </label>
            <label>
              Priority
              <select
                value={task.priority}
                onChange={(e) =>
                  onUpdate({ priority: Number(e.target.value) as Priority })
                }
              >
                <option value={1}>P1 — urgent</option>
                <option value={2}>P2 — high</option>
                <option value={3}>P3 — medium</option>
                <option value={4}>P4 — none</option>
              </select>
            </label>
            <label>
              Project
              <select
                value={task.projectId ?? ''}
                onChange={(e) => onUpdate({ projectId: e.target.value || null })}
              >
                <option value="">Inbox</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Repeat
              <select
                value={task.recurrence?.freq ?? ''}
                onChange={(e) => {
                  const freq = e.target.value as RecurrenceFreq | ''
                  if (!freq) {
                    onUpdate({ recurrence: null })
                  } else {
                    // A repeat rule needs a due date to roll from.
                    onUpdate({
                      recurrence: { freq, interval: task.recurrence?.interval ?? 1 },
                      due: task.due ?? todayStr(),
                    })
                  }
                }}
              >
                <option value="">No repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          </div>
          {task.recurrence && (
            <label className="task-edit-interval">
              Every
              <input
                type="number"
                min={1}
                max={365}
                value={task.recurrence.interval}
                onChange={(e) =>
                  onUpdate({
                    recurrence: {
                      ...task.recurrence!,
                      interval: Math.max(1, Number(e.target.value) || 1),
                    },
                  })
                }
              />
              {INTERVAL_UNIT[task.recurrence.freq]}
            </label>
          )}

          {/* Updates: what happened, in the task's own words. Append-only by
              design — a status log you can overwrite is just a notes field, and
              the point of these is that they're dated. */}
          <div className="task-updates">
            <div className="task-updates-title">
              Updates
              {comments.length > 0 && (
                <span className="task-count">{comments.length}</span>
              )}
            </div>

            {comments.map((c) => (
              <div key={c.id} className="task-comment">
                <div className="task-comment-body">{c.body}</div>
                <div className="task-comment-foot">
                  <span className="task-comment-when">{timeAgo(c.createdAt)}</span>
                  <button
                    type="button"
                    className="icon-btn trash-danger task-comment-del"
                    title="Delete this update"
                    aria-label="Delete this update"
                    onClick={() => onDeleteComment(c.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}

            <textarea
              className="task-comment-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter makes a paragraph; the modifier posts. The other way
                // round loses half-written updates to a stray Return.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  postComment()
                }
              }}
              rows={2}
              placeholder="Add an update…"
              aria-label="Add an update"
            />
            <div className="task-updates-actions">
              <button
                type="button"
                className="btn-secondary task-comment-add"
                onClick={postComment}
                disabled={!draft.trim()}
              >
                Add update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
