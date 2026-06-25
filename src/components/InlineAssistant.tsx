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

interface InlineAssistantProps {
  selectedText: string
  ask: (instruction: string, selectedText: string, signal: AbortSignal) => Promise<string>
  onReplace: (text: string) => void
  onInsertBelow: (text: string) => void
  onClose: () => void
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
  onClose,
}: InlineAssistantProps) {
  const [phase, setPhase] = useState<Phase>('menu')
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [lastInstruction, setLastInstruction] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const run = async (instruction: string) => {
    if (!instruction.trim()) return
    setLastInstruction(instruction)
    setPhase('loading')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const out = await ask(instruction, selectedText, controller.signal)
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
        <div className="inline-ai-loading">
          <span>Thinking…</span>
          <button className="inline-ai-textbtn" onClick={cancel}>
            Cancel
          </button>
        </div>
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
          <div className="inline-ai-result">{result}</div>
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
