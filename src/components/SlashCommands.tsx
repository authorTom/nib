import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HelpCircle, Lightbulb, ListChecks, Sparkles, Text } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { serialize } from '../editor/markdown'
import type { InlineAsk } from './InlineAssistant'

/**
 * `/` commands at the caret.
 *
 * The same pattern as the `[[` picker next door — a caret-anchored popover that
 * inserts nothing until a command is chosen, so an abandoned `/` stays the
 * character the user typed. Deliberately not `@tiptap/suggestion`: that owns a
 * node view and a decoration set to do what one regex on the text before the
 * caret already does here, and two suggestion mechanisms in one editor is one
 * more than this needs.
 *
 * Every command runs through the same read-only assistant the selection
 * popover uses, so `/ask` can search the library and cite it.
 */

interface SlashCommandsProps {
  editor: Editor | null
  ask: InlineAsk
}

/** An unclosed `/word`, optionally with words after it, right before the caret. */
const TRIGGER = /\/([a-zA-Z]*)( [^\n]*)?$/

interface Command {
  name: string
  hint: string
  Icon: typeof Sparkles
  /** True when the words after the command *are* the instruction. */
  takesArgument?: boolean
  /** What to ask for. `argument` is whatever was typed after the command. */
  instruction: (argument: string) => string
  /** Whether the command reads the whole note or just the block it sits in. */
  scope: 'note' | 'block'
}

const COMMANDS: Command[] = [
  {
    name: 'ask',
    hint: 'Ask a question — searches your other notes and cites them',
    Icon: HelpCircle,
    takesArgument: true,
    instruction: (argument) => argument,
    scope: 'note',
  },
  {
    name: 'summarize',
    hint: 'Summarize this note',
    Icon: Text,
    instruction: (argument) =>
      `Summarize this note${argument ? ` — ${argument}` : ''}. A short paragraph, or a few bullets if it has distinct parts.`,
    scope: 'note',
  },
  {
    name: 'explain',
    hint: 'Explain what you were just writing',
    Icon: Lightbulb,
    instruction: (argument) =>
      `Explain this in plain language${argument ? `, focusing on ${argument}` : ''}.`,
    scope: 'block',
  },
  {
    name: 'todo',
    hint: 'Pull the action items out as a task list',
    Icon: ListChecks,
    instruction: () =>
      'Extract every action item as a Markdown task list ("- [ ] …"). One line each, phrased as something a person can do. If there are none, say so in one line.',
    scope: 'note',
  },
]

interface Trigger {
  /** The partial command name being typed. */
  query: string
  /** Whatever follows it on the line. */
  argument: string
  /** Document position of the `/`. */
  from: number
  left: number
  top: number
}

export default function SlashCommands({ editor, ask }: SlashCommandsProps) {
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [index, setIndex] = useState(0)
  const [running, setRunning] = useState<{ label: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Abandon an in-flight command if the pane goes away under it.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      const { from, empty } = editor.state.selection
      if (!empty) return setTrigger(null)
      const before = editor.state.doc.textBetween(Math.max(0, from - 200), from, '\n')
      const m = TRIGGER.exec(before)
      if (!m) return setTrigger(null)
      // A slash mid-word is a path or a date, not a command.
      const start = before.length - m[0].length
      if (start > 0 && !/\s/.test(before[start - 1])) return setTrigger(null)
      const coords = editor.view.coordsAtPos(from)
      setTrigger({
        query: m[1],
        argument: (m[2] ?? '').trim(),
        from: from - m[0].length,
        left: coords.left,
        top: coords.bottom,
      })
      setIndex(0)
    }
    sync()
    editor.on('update', sync)
    editor.on('selectionUpdate', sync)
    return () => {
      editor.off('update', sync)
      editor.off('selectionUpdate', sync)
    }
  }, [editor])

  const matches = useMemo(() => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    // Once there are words after the command, only an exact name still counts —
    // otherwise "/asking around" would keep the menu open over a sentence.
    if (trigger.argument) return COMMANDS.filter((c) => c.name === q)
    return COMMANDS.filter((c) => c.name.startsWith(q))
  }, [trigger])

  /** The text a command reads: the whole note, or just the block it sits in. */
  const sourceFor = useCallback(
    (command: Command, at: number): string => {
      if (!editor) return ''
      if (command.scope === 'note') return serialize(editor)
      const $pos = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size))
      return $pos.parent.textContent
    },
    [editor],
  )

  const run = useCallback(
    async (command: Command) => {
      if (!editor || !trigger) return
      if (command.takesArgument && !trigger.argument) return
      const at = trigger.from
      const source = sourceFor(command, at)
      // Take the typed command out first: the answer lands where it stood, and
      // a cancelled run leaves a clean line rather than "/summarize".
      editor
        .chain()
        .focus()
        .deleteRange({ from: at, to: editor.state.selection.from })
        .run()
      setTrigger(null)
      setError(null)
      setRunning({ label: `/${command.name}`, text: '' })

      const controller = new AbortController()
      abortRef.current = controller
      try {
        const out = await ask(
          command.instruction(trigger.argument),
          source,
          controller.signal,
          (snapshot) => setRunning({ label: `/${command.name}`, text: snapshot }),
        )
        if (controller.signal.aborted) return
        // One insert, one undo step. The answer streams into the popover above
        // rather than into the document, so that Ctrl+Z takes the whole answer
        // back out instead of unwinding it a token at a time.
        if (out.trim()) {
          editor.chain().focus().insertContentAt(at, `\n\n${out.trim()}`).run()
        }
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') setError(err.message)
      } finally {
        abortRef.current = null
        setRunning(null)
      }
    },
    [ask, editor, sourceFor, trigger],
  )

  // Intercept navigation keys before ProseMirror sees them.
  useEffect(() => {
    if (!editor || !trigger || matches.length === 0) return
    const dom = editor.view.dom
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex((i) => (i + 1) % matches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => (i - 1 + matches.length) % matches.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const command = matches[Math.min(index, matches.length - 1)]
        // `/ask` with nothing after it is still being typed — let Enter through
        // rather than sending an empty question.
        if (command.takesArgument && !trigger.argument) return
        e.preventDefault()
        e.stopPropagation()
        void run(command)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setTrigger(null)
      }
    }
    dom.addEventListener('keydown', onKey, true)
    return () => dom.removeEventListener('keydown', onKey, true)
  }, [editor, trigger, matches, index, run])

  if (running || error) {
    return (
      <div className="slash-running" role="status">
        <span className="slash-running-head">
          <Sparkles size={13} />
          {error ? 'Trevor stopped' : `${running?.label} — writing…`}
        </span>
        <div className="slash-running-body">{error ?? running?.text}</div>
        <button
          type="button"
          className="inline-ai-textbtn"
          onClick={() => {
            abortRef.current?.abort()
            setError(null)
          }}
        >
          {error ? 'Dismiss' : 'Cancel'}
        </button>
      </div>
    )
  }

  if (!trigger || matches.length === 0) return null

  return (
    <div
      className="slash-suggest"
      style={{ left: trigger.left, top: trigger.top + 6 }}
      role="listbox"
      aria-label="Assistant commands"
    >
      {matches.map((command, i) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={i === index}
          className={`slash-suggest-item${i === index ? ' selected' : ''}`}
          onMouseMove={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            void run(command)
          }}
        >
          <command.Icon size={14} />
          <span className="slash-suggest-name">
            /{command.name}
            {command.takesArgument && <em> your question</em>}
          </span>
          <span className="slash-suggest-hint">{command.hint}</span>
        </button>
      ))}
    </div>
  )
}
