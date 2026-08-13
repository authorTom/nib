// What the assistant has remembered, and the means to disagree with it.
//
// Memory that a user cannot read is a liability: the assistant behaves oddly
// and there is nowhere to look. So this lists every memory in full, says where
// each one lives on disk, and lets any of them be edited or deleted on the
// spot. Nothing here is clever — it is the receipt.

import { useCallback, useEffect, useState } from 'react'
import { Pin, RotateCcw, Trash2, X } from 'lucide-react'
import { useEnterExit } from '../hooks/useEnterExit'
import { OVERLAY_EXIT_MS } from '../lib/motion'
import { deleteMemory, loadMemories, updateMemory } from '../memory/store'
import { estimateTokens } from '../memory/context'
import { KIND_FOLDER, type Memory, type MemoryKind } from '../memory/types'

interface MemoryModalProps {
  open: boolean
  dir: FileSystemDirectoryHandle | null
  /** Bumped when the assistant writes, so an open panel refetches. */
  revision: number
  onClose: () => void
}

const KIND_LABEL: Record<MemoryKind, string> = {
  preference: 'Preferences',
  project: 'Projects',
  person: 'People',
  fact: 'Facts',
  convention: 'Conventions',
}

export default function MemoryModal({
  open,
  dir,
  revision,
  onClose,
}: MemoryModalProps) {
  const anim = useEnterExit(open, OVERLAY_EXIT_MS)
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const reload = useCallback(async () => {
    if (!dir) return
    setLoading(true)
    try {
      // Forced: the panel is exactly where someone looks after editing a
      // memory file by hand in another editor.
      setMemories(await loadMemories(dir, true))
    } finally {
      setLoading(false)
    }
  }, [dir])

  useEffect(() => {
    if (open) void reload()
  }, [open, revision, reload])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!anim.render) return null

  const save = async (memory: Memory) => {
    if (!dir) return
    setEditing(null)
    await updateMemory(dir, memory.path, { body: draft })
    await reload()
  }

  const remove = async (memory: Memory) => {
    if (!dir) return
    await deleteMemory(dir, memory.path)
    await reload()
  }

  const togglePin = async (memory: Memory) => {
    if (!dir) return
    await updateMemory(dir, memory.path, { pinned: !memory.pinned })
    await reload()
  }

  // Pinned memories cost tokens on every single message, so their weight is
  // the one number worth putting in front of the user.
  const pinnedCost = memories
    .filter((m) => m.pinned)
    .reduce((sum, m) => sum + estimateTokens(`${m.summary}\n${m.body}`), 0)

  const kinds = (Object.keys(KIND_FOLDER) as MemoryKind[]).filter((kind) =>
    memories.some((m) => m.kind === kind),
  )

  return (
    <div
      className={`modal-overlay${anim.entered ? ' entered' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal memory-modal${anim.entered ? ' entered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Assistant memory"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Memory</span>
          <div className="memory-header-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => void reload()}
              title="Reload from disk"
              aria-label="Reload from disk"
            >
              <RotateCcw size={16} />
            </button>
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
        </div>

        <div className="modal-body">
          {memories.length === 0 ? (
            <div className="modal-empty">
              {loading
                ? 'Reading…'
                : 'Nothing remembered yet. The assistant writes here as it learns how you work.'}
            </div>
          ) : (
            <>
              <p className="modal-note">
                {memories.length} memor{memories.length === 1 ? 'y' : 'ies'} in{' '}
                <code>.deckle/memory/</code>
                {pinnedCost > 0 && (
                  <>
                    {' '}
                    · pinned ones cost roughly {pinnedCost} tokens on every message
                  </>
                )}
                .
              </p>

              {kinds.map((kind) => (
                <section key={kind} className="memory-group">
                  <h3 className="memory-group-title">{KIND_LABEL[kind]}</h3>
                  {memories
                    .filter((m) => m.kind === kind)
                    .map((memory) => (
                      <article key={memory.path} className="memory-item">
                        <div className="memory-item-head">
                          <span className="memory-summary">{memory.summary}</span>
                          <span className="memory-actions">
                            <button
                              type="button"
                              className={`tree-action${memory.pinned ? ' active' : ''}`}
                              title={
                                memory.pinned
                                  ? 'Unpin — stop sending this on every message'
                                  : 'Pin — always send this'
                              }
                              aria-label={memory.pinned ? 'Unpin' : 'Pin'}
                              onClick={() => void togglePin(memory)}
                            >
                              {/* One icon, lit when pinned. Swapping to a
                                  crossed-out pin would show the state where
                                  the button should show the action. */}
                              <Pin size={14} />
                            </button>
                            <button
                              type="button"
                              className="tree-action danger"
                              title="Forget this"
                              aria-label={`Forget ${memory.summary}`}
                              onClick={() => void remove(memory)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </span>
                        </div>

                        {editing === memory.path ? (
                          <div className="memory-edit">
                            <textarea
                              className="memory-textarea"
                              value={draft}
                              autoFocus
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label={`Edit ${memory.summary}`}
                            />
                            <div className="memory-edit-actions">
                              <button
                                type="button"
                                className="btn-quiet"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn-primary"
                                onClick={() => void save(memory)}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="memory-body"
                            title="Edit"
                            onClick={() => {
                              setEditing(memory.path)
                              setDraft(memory.body)
                            }}
                          >
                            {memory.body}
                          </button>
                        )}

                        <div className="memory-meta">
                          <span className="memory-path">{memory.path}</span>
                          {memory.tags.map((tag) => (
                            <span key={tag} className="memory-tag">
                              {tag}
                            </span>
                          ))}
                          <span className="memory-uses">
                            used {memory.uses}×
                          </span>
                          <span className="memory-date">{memory.updated}</span>
                        </div>
                      </article>
                    ))}
                </section>
              ))}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
