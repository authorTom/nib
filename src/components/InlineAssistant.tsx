import { useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  Copy,
  CornerDownRight,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { WIKILINK_RE } from '../lib/wikilinks'

export type InlineAsk = (
  instruction: string,
  selectedText: string,
  signal: AbortSignal,
  onText?: (snapshot: string) => void,
) => Promise<string>

interface InlineAssistantProps {
  selectedText: string
  ask: InlineAsk
  onReplace: (text: string) => void
  onInsertBelow: (text: string) => void
  /**
   * Follow a `[[wikilink]]` the answer cited. Absent when nothing can resolve
   * it, in which case citations stay plain text rather than pretending to be
   * links that go nowhere.
   */
  onOpenLink?: (target: string) => void
  onClose: () => void
}

/**
 * Render an answer with its `[[citations]]` as buttons.
 *
 * The assistant is told to cite the notes it read, and a citation you cannot
 * follow is just punctuation. The same brackets become real wikilinks the
 * moment the text is inserted into the document — this only makes them work in
 * the preview, before the user has decided to keep anything.
 */
function AnswerText({
  text,
  onOpenLink,
}: {
  text: string
  onOpenLink?: (target: string) => void
}) {
  if (!onOpenLink) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(text))) {
    if (m.index > cursor) parts.push(text.slice(cursor, m.index))
    const target = m[1].trim()
    parts.push(
      <button
        key={`${m.index}-${target}`}
        type="button"
        className="inline-ai-cite"
        title={`Open ${target}`}
        onClick={() => onOpenLink(target)}
      >
        {m[2]?.trim() || target}
      </button>,
    )
    cursor = m.index + m[0].length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

const PRESETS = [
  { label: 'Improve writing', instruction: 'Improve the writing for clarity, flow, and grammar. Keep the meaning and language.' },
  { label: 'Fix spelling & grammar', instruction: 'Fix spelling and grammar only. Keep the wording and meaning unchanged.' },
  { label: 'Make shorter', instruction: 'Make this more concise while keeping the key information.' },
  { label: 'Make longer', instruction: 'Expand this with more detail and explanation.' },
  { label: 'Summarize', instruction: 'Summarize this concisely.' },
  { label: 'Explain', instruction: 'Explain what this means in simple, plain language.' },
]

type Phase = 'menu' | 'loading' | 'result' | 'error'

export default function InlineAssistant({
  selectedText,
  ask,
  onReplace,
  onInsertBelow,
  onOpenLink,
  onClose,
}: InlineAssistantProps) {
  const [phase, setPhase] = useState<Phase>('menu')
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  /** The answer so far, while it is still arriving. */
  const [partial, setPartial] = useState('')
  const [error, setError] = useState('')
  const [lastInstruction, setLastInstruction] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const run = async (instruction: string) => {
    if (!instruction.trim()) return
    setLastInstruction(instruction)
    setPartial('')
    setPhase('loading')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const out = await ask(instruction, selectedText, controller.signal, setPartial)
      setResult(out)
      setPhase('result')
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        setPhase('menu')
      } else {
        setError(err.message)
        setPhase('error')
      }
    } finally {
      abortRef.current = null
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPhase('menu')
  }

  return (
    <div className="inline-ai" onMouseDown={(e) => e.stopPropagation()}>
      <div className="inline-ai-head">
        <span>
          <Sparkles size={13} /> Ask AI about selection
        </span>
        <button className="inline-ai-x" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      {phase === 'menu' && (
        <>
          <div className="inline-ai-actions">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className="inline-ai-action"
                onClick={() => run(p.instruction)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="inline-ai-input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  run(input)
                }
              }}
              placeholder="Or describe a change…"
              autoFocus
            />
            <button
              className="inline-ai-send"
              onClick={() => run(input)}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </>
      )}

      {phase === 'loading' && (
        <>
          {partial && (
            <div className="inline-ai-result streaming">
              <AnswerText text={partial} onOpenLink={onOpenLink} />
            </div>
          )}
          <div className="inline-ai-loading">
            <span>{partial ? 'Writing…' : 'Thinking…'}</span>
            <button className="inline-ai-textbtn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {phase === 'error' && (
        <div className="inline-ai-error">
          <p>⚠️ {error}</p>
          <button className="inline-ai-textbtn" onClick={() => setPhase('menu')}>
            Back
          </button>
        </div>
      )}

      {phase === 'result' && (
        <>
          <div className="inline-ai-result">
            <AnswerText text={result} onOpenLink={onOpenLink} />
          </div>
          <div className="inline-ai-result-actions">
            <button className="inline-ai-apply" onClick={() => onReplace(result)}>
              <Check size={13} /> Replace
            </button>
            <button className="inline-ai-textbtn" onClick={() => onInsertBelow(result)}>
              <CornerDownRight size={13} /> Insert below
            </button>
            <button
              className="inline-ai-textbtn"
              onClick={() => void navigator.clipboard?.writeText(result)}
            >
              <Copy size={13} /> Copy
            </button>
            <button className="inline-ai-textbtn" onClick={() => run(lastInstruction)}>
              <RotateCcw size={13} /> Retry
            </button>
          </div>
        </>
      )}
    </div>
  )
}
