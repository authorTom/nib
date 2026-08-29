import { useEffect, useState } from 'react'
import { Check, FileEdit, MessageSquare, X } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { ApprovalDiff } from './ApprovalCard'
import type { PendingAction } from '../ai/useAssistant'

interface InlineApprovalProps {
  editor: Editor | null
  action: PendingAction
  onApprove: (id: string) => void
  onReject: (id: string) => void
  /** Go back to the conversation the proposal came out of. */
  onOpenChat: () => void
}

/**
 * "Trevor wants to edit this note" — asked at the caret, in the note.
 *
 * The chat panel asks the same question, but it asks it from a modal sheet
 * dropped over the page: you approve a change to a note you can no longer see.
 * When the proposal is about the note you have open, this is where the question
 * belongs — beside the text it is about, using the same diff so the two can't
 * disagree.
 *
 * Anchored the way the `[[` picker is, against the caret, and pinned to the top
 * of the pane when the caret is off screen — there is always a question here,
 * so it must never be positioned somewhere the user cannot find it.
 */
export default function InlineApproval({
  editor,
  action,
  onApprove,
  onReject,
  onOpenChat,
}: InlineApprovalProps) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const place = () => {
      const pane = editor.view.dom.getBoundingClientRect()
      let top = pane.top + 12
      let left = pane.left
      try {
        const caret = editor.view.coordsAtPos(editor.state.selection.from)
        // Only follow the caret while it is actually in view; a card hanging
        // off the top of the window is a question nobody gets asked.
        if (caret.bottom > 0 && caret.bottom < window.innerHeight - 120) {
          top = caret.bottom + 8
          left = caret.left
        }
      } catch {
        // The document changed under the stored position — fall back to the pane.
      }
      setAt({ left: Math.max(8, Math.min(left, window.innerWidth - 400)), top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [editor, action.id])

  if (!at) return null

  return (
    <div
      className="inline-approval"
      style={{ left: at.left, top: at.top }}
      role="dialog"
      aria-label="Approve this change"
    >
      <div className="approval-head">
        <FileEdit size={15} />
        <span className="approval-summary">{action.preview.summary}</span>
        <button
          type="button"
          className="inline-approval-chat"
          onClick={onOpenChat}
          title="Show the conversation this came from"
        >
          <MessageSquare size={14} />
        </button>
      </div>
      {action.preview.kind === 'write' && (
        <ApprovalDiff
          before={action.preview.before ?? ''}
          after={action.preview.after ?? ''}
        />
      )}
      <div className="approval-actions">
        <button className="btn-approve" onClick={() => onApprove(action.id)}>
          <Check size={14} /> Approve
        </button>
        <button className="btn-reject" onClick={() => onReject(action.id)}>
          <X size={14} /> Reject
        </button>
      </div>
    </div>
  )
}
