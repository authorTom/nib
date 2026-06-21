import type { Editor } from '@tiptap/react'
import {
  formatActions,
  headingActions,
  listActions,
  type FormatAction,
} from './formatActions'

function ActionButton({
  editor,
  action,
}: {
  editor: Editor
  action: FormatAction
}) {
  const { Icon, label, run, isActive } = action
  return (
    <button
      type="button"
      className={`toolbar-btn${isActive(editor) ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={isActive(editor)}
      onClick={() => run(editor)}
    >
      <Icon size={18} />
    </button>
  )
}

export default function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {headingActions.map((a) => (
        <ActionButton key={a.name} editor={editor} action={a} />
      ))}
      <span className="toolbar-divider" />
      {formatActions.map((a) => (
        <ActionButton key={a.name} editor={editor} action={a} />
      ))}
      <span className="toolbar-divider" />
      {listActions.map((a) => (
        <ActionButton key={a.name} editor={editor} action={a} />
      ))}
    </div>
  )
}
