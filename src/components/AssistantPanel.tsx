import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Brain,
  Check,
  CheckCheck,
  FileEdit,
  FileText,
  Settings2,
  Sparkles,
  Square,
  SquarePen,
  X,
} from 'lucide-react'
import type { AssistantStatus, PendingAction } from '../ai/useAssistant'
import type { AssistantSettings, ChatMessage, Provider } from '../ai/types'

interface AssistantPanelProps {
  open: boolean
  onClose: () => void
  filePaths: string[]
  activePath: string | null
  settings: AssistantSettings
  onUpdateSettings: (s: AssistantSettings) => void
  messages: ChatMessage[]
  status: AssistantStatus
  pending: PendingAction[]
  onSend: (text: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveAll: () => void
  onStop: () => void
  onClear: () => void
}

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  lmstudio: 'Local (LM Studio)',
}

function ApprovalCard({
  action,
  onApprove,
  onReject,
}: {
  action: PendingAction
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const decided = action.status !== 'pending'
  return (
    <div className={`approval-card status-${action.status}`}>
      <div className="approval-head">
        <FileEdit size={15} />
        <span className="approval-summary">{action.preview.summary}</span>
      </div>
      {action.preview.kind === 'write' && (
        <pre className="approval-diff">
          {action.preview.after}
        </pre>
      )}
      {!decided ? (
        <div className="approval-actions">
          <button className="btn-approve" onClick={() => onApprove(action.id)}>
            <Check size={14} /> Approve
          </button>
          <button className="btn-reject" onClick={() => onReject(action.id)}>
            <X size={14} /> Reject
          </button>
        </div>
      ) : (
        <div className={`approval-result ${action.status}`}>
          {action.status === 'approved' ? 'Approved' : 'Rejected'}
        </div>
      )}
    </div>
  )
}

function ToolChip({ message }: { message: ChatMessage }) {
  return (
    <div className={`tool-chip${message.isError ? ' error' : ''}`}>
      <span className="tool-chip-name">{message.toolName}</span>
      <span className="tool-chip-body">{message.content}</span>
    </div>
  )
}

function SettingsView({
  settings,
  onUpdateSettings,
  onDone,
}: {
  settings: AssistantSettings
  onUpdateSettings: (s: AssistantSettings) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const set = (patch: Partial<AssistantSettings>) => setDraft({ ...draft, ...patch })
  const setModel = (key: keyof AssistantSettings['models'], value: string) =>
    setDraft({ ...draft, models: { ...draft.models, [key]: value } })

  const save = () => {
    onUpdateSettings(draft)
    onDone()
  }

  return (
    <div className="assistant-settings">
      <label className="field">
        <span>Provider</span>
        <select
          value={draft.provider}
          onChange={(e) => set({ provider: e.target.value as Provider })}
        >
          <option value="lmstudio">Local (LM Studio)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
        </select>
      </label>

      {draft.provider === 'anthropic' && (
        <>
          <label className="field">
            <span>Anthropic API key</span>
            <input
              type="password"
              value={draft.anthropicKey}
              onChange={(e) => set({ anthropicKey: e.target.value })}
              placeholder="sk-ant-..."
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={draft.models.anthropic}
              onChange={(e) => setModel('anthropic', e.target.value)}
            />
          </label>
        </>
      )}

      {draft.provider === 'openai' && (
        <>
          <label className="field">
            <span>OpenAI API key</span>
            <input
              type="password"
              value={draft.openaiKey}
              onChange={(e) => set({ openaiKey: e.target.value })}
              placeholder="sk-..."
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={draft.models.openai}
              onChange={(e) => setModel('openai', e.target.value)}
            />
          </label>
        </>
      )}

      {draft.provider === 'lmstudio' && (
        <>
          <label className="field">
            <span>LM Studio server URL</span>
            <input
              value={draft.lmstudioUrl}
              onChange={(e) => set({ lmstudioUrl: e.target.value })}
              placeholder="http://localhost:1234/v1"
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={draft.models.lmstudio}
              onChange={(e) => setModel('lmstudio', e.target.value)}
            />
          </label>
        </>
      )}

      {draft.provider !== 'openai' && (
        <label className="field-row">
          <input
            type="checkbox"
            checked={draft.thinking}
            onChange={(e) => set({ thinking: e.target.checked })}
          />
          <span>
            {draft.provider === 'anthropic'
              ? 'Extended thinking (Claude reasons before answering)'
              : 'Thinking (for reasoning models, e.g. Qwen3 / DeepSeek-R1)'}
          </span>
        </label>
      )}

      <label className="field">
        <span>Custom instructions</span>
        <textarea
          value={draft.systemPrompt}
          onChange={(e) => set({ systemPrompt: e.target.value })}
          rows={4}
          placeholder="e.g. Always write in British English. Keep notes concise and use bullet points."
        />
        <span className="assistant-note">
          Added to every message to guide the assistant's behavior and style.
        </span>
      </label>

      {draft.provider !== 'lmstudio' && (
        <p className="assistant-note">
          Your API key is stored only in this browser and sent directly to the provider.
          For maximum privacy, use the local LM Studio option.
        </p>
      )}

      <button className="btn-primary" onClick={save}>
        Save
      </button>
    </div>
  )
}

/** Detect a "/path" token being typed at the caret (for the file picker). */
function getMention(value: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1
  while (i >= 0 && !/\s/.test(value[i])) {
    if (value[i] === '/') {
      if (i === 0 || /\s/.test(value[i - 1])) {
        return { start: i, query: value.slice(i + 1, caret) }
      }
      return null
    }
    i--
  }
  return null
}

export default function AssistantPanel({
  open,
  onClose,
  filePaths,
  activePath,
  settings,
  onUpdateSettings,
  messages,
  status,
  pending,
  onSend,
  onApprove,
  onReject,
  onApproveAll,
  onStop,
  onClear,
}: AssistantPanelProps) {
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, pending, status])

  if (!open) return null

  const busy = status === 'thinking' || status === 'awaiting-approval'
  const pendingCount = pending.filter((p) => p.status === 'pending').length

  const suggestions = mention
    ? filePaths
        .filter((p) => p.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 8)
    : []

  const refreshMention = (value: string, caret: number) => {
    setMention(getMention(value, caret))
    setMentionIndex(0)
  }

  const pickFile = (path: string) => {
    const ta = textareaRef.current
    const caret = ta?.selectionStart ?? input.length
    if (!mention) return
    const before = input.slice(0, mention.start)
    const after = input.slice(caret)
    const next = `${before}${path} ${after}`
    setInput(next)
    setMention(null)
    const pos = before.length + path.length + 1
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(pos, pos)
    })
  }

  const submit = () => {
    if (!input.trim() || busy) return
    onSend(input)
    setInput('')
    setMention(null)
  }

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <span className="assistant-title">
          <Sparkles size={16} /> Assistant
        </span>
        <div className="assistant-header-actions">
          {settings.provider !== 'openai' && (
            <button
              className={`icon-btn${settings.thinking ? ' active' : ''}`}
              onClick={() =>
                onUpdateSettings({ ...settings, thinking: !settings.thinking })
              }
              title={settings.thinking ? 'Thinking: on' : 'Thinking: off'}
              aria-label="Toggle thinking"
              aria-pressed={settings.thinking}
            >
              <Brain size={17} />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onClear}
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen size={17} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettings((s) => !s)}
            title="Settings"
            aria-label="Assistant settings"
          >
            <Settings2 size={17} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close assistant">
            <X size={18} />
          </button>
        </div>
      </div>

      {showSettings ? (
        <SettingsView
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onDone={() => setShowSettings(false)}
        />
      ) : (
        <>
          <div className="assistant-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="assistant-empty">
                <Sparkles size={26} />
                <p>
                  Ask me to summarize, reorganize, draft, or edit your notes. I can read
                  the whole vault and propose changes for your approval.
                </p>
                <p className="assistant-note">
                  Type <strong>/</strong> to reference a specific note.
                  {activePath && (
                    <>
                      {' '}I can already see the open note (<strong>{activePath}</strong>).
                    </>
                  )}
                </p>
                <p className="assistant-note">
                  Using <strong>{PROVIDER_LABEL[settings.provider]}</strong>.
                </p>
              </div>
            )}
            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="msg msg-user">
                    {m.content}
                  </div>
                )
              }
              if (m.role === 'tool') {
                return <ToolChip key={m.id} message={m} />
              }
              return (
                <div key={m.id} className={`msg msg-assistant${m.isError ? ' error' : ''}`}>
                  {m.content && <div className="msg-text">{m.content}</div>}
                </div>
              )
            })}

            {pending.length > 0 && (
              <div className="approval-group">
                {pendingCount > 1 && (
                  <button className="btn-approve-all" onClick={onApproveAll}>
                    <CheckCheck size={14} /> Approve all ({pendingCount})
                  </button>
                )}
                {pending.map((a) => (
                  <ApprovalCard key={a.id} action={a} onApprove={onApprove} onReject={onReject} />
                ))}
              </div>
            )}

            {status === 'thinking' && <div className="assistant-thinking">Thinking…</div>}
          </div>

          <div className="assistant-input">
            {mention && suggestions.length > 0 && (
              <div className="mention-pop">
                {suggestions.map((path, i) => (
                  <button
                    key={path}
                    type="button"
                    className={`mention-item${i === mentionIndex ? ' active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickFile(path)
                    }}
                  >
                    <FileText size={14} />
                    <span>{path}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }}
              onClick={(e) =>
                refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
              }
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                  refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
              }}
              onKeyDown={(e) => {
                if (mention && suggestions.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionIndex((i) => (i + 1) % suggestions.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    pickFile(suggestions[mentionIndex])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMention(null)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Ask the assistant…  (type / to reference a note)"
              rows={2}
              disabled={status === 'awaiting-approval'}
            />
            {status === 'thinking' ? (
              <button className="assistant-send stop" onClick={onStop} title="Stop">
                <Square size={16} />
              </button>
            ) : (
              <button
                className="assistant-send"
                onClick={submit}
                disabled={!input.trim() || busy}
                title="Send"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
