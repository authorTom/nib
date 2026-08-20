import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Brain,
  CheckCheck,
  FileText,
  ListPlus,
  Settings2,
  Sparkles,
  Square,
  SquarePen,
  X,
} from 'lucide-react'
import { MOD_KEY } from '../lib/platform'
import type { AssistantStatus, PendingAction } from '../ai/useAssistant'
import { ApprovalCard } from './ApprovalCard'
import type { AssistantSettings, ChatMessage, Provider } from '../ai/types'
import type { Sharing } from '../ai/remoteSettings'
import ModelPicker, {
  ModelField,
  PROVIDER_LABEL,
  currentSelection,
  isConfigured,
} from './ModelPicker'
import QueueView, { QueueTicker, groupRuns } from './QueueView'
import type { QueueApi } from '../queue/useQueue'
import { hasThinkingToggle } from '../ai/models'

interface AssistantPanelProps {
  open: boolean
  onClose: () => void
  filePaths: string[]
  activePath: string | null
  settings: AssistantSettings
  onUpdateSettings: (s: AssistantSettings) => void
  /** Which half of the panel is showing: the conversation, or the queue. */
  view: 'chat' | 'queue'
  onViewChange: (view: 'chat' | 'queue') => void
  /** Whether these settings belong to this browser or to the server. */
  sharing: Sharing
  /** Set when the server wouldn't keep the last save. */
  settingsError: string | null
  messages: ChatMessage[]
  status: AssistantStatus
  pending: PendingAction[]
  onSend: (text: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveAll: () => void
  onStop: () => void
  onClear: () => void
  /**
   * Background work. The queue lives in here rather than in a panel of its own:
   * asking and delegating are the same act, so they share one composer.
   */
  queue: QueueApi
  onOpenRun: (id: string) => void
  /** Open a note a run wrote, straight from the queue. */
  onOpenNote: (path: string) => void
}

/**
 * The changed lines of a proposed edit, with enough context to place them.
 *
 * A new file has no "before", so it is shown whole and labelled as a creation
 * rather than dressed up as a diff against nothing.
 */
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
  sharing,
  settingsError,
  onDone,
}: {
  settings: AssistantSettings
  onUpdateSettings: (s: AssistantSettings) => void
  sharing: Sharing
  settingsError: string | null
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
          {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
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
          <ModelField
            settings={draft}
            provider="anthropic"
            value={draft.models.anthropic}
            onChange={(model) => setModel('anthropic', model)}
          />
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
          <ModelField
            settings={draft}
            provider="openai"
            value={draft.models.openai}
            onChange={(model) => setModel('openai', model)}
          />
        </>
      )}

      {draft.provider === 'openrouter' && (
        <>
          <label className="field">
            <span>OpenRouter API key</span>
            <input
              type="password"
              value={draft.openrouterKey}
              onChange={(e) => set({ openrouterKey: e.target.value })}
              placeholder="sk-or-..."
            />
          </label>
          <ModelField
            settings={draft}
            provider="openrouter"
            value={draft.models.openrouter}
            onChange={(model) => setModel('openrouter', model)}
          />
          <span className="assistant-note">
            Custom takes any slug from openrouter.ai/models, e.g.{' '}
            <code>anthropic/claude-opus-5</code>.
          </span>
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
          <ModelField
            settings={draft}
            provider="lmstudio"
            value={draft.models.lmstudio}
            onChange={(model) => setModel('lmstudio', model)}
          />
        </>
      )}

      <label className="field-row">
        <input
          type="checkbox"
          checked={draft.memory}
          onChange={(e) => set({ memory: e.target.checked })}
        />
        <span>Memory — remember what it learns about you</span>
      </label>
      <span className="assistant-note">
        Kept as Markdown in <code>.deckle/memory/</code> inside your library, so it
        syncs and backs up with your notes. Only a one-line index is sent on every
        message; the rest is fetched when it's relevant. Read, edit and delete it
        from the Memory panel.
      </span>

      {hasThinkingToggle(draft.provider, draft.models[draft.provider]) && (
        <label className="field-row">
          <input
            type="checkbox"
            checked={draft.thinking}
            onChange={(e) => set({ thinking: e.target.checked })}
          />
          <span>
            {draft.provider === 'anthropic'
              ? 'Extended thinking (Claude reasons before answering)'
              : draft.provider === 'openrouter'
                ? 'Reasoning (for models that support it, e.g. DeepSeek / Qwen)'
                : 'Thinking (for reasoning models, e.g. Qwen3 / DeepSeek-R1)'}
          </span>
        </label>
      )}

      {(draft.provider === 'openai' || draft.provider === 'lmstudio') && (
        <>
          <label className="field-row">
            <input
              type="checkbox"
              checked={draft.semanticSearch}
              onChange={(e) => set({ semanticSearch: e.target.checked })}
            />
            <span>Semantic library search (embeddings)</span>
          </label>
          {draft.semanticSearch && (
            <label className="field">
              <span>Embedding model</span>
              <input
                value={draft.embeddingModel}
                onChange={(e) => set({ embeddingModel: e.target.value })}
                placeholder={
                  draft.provider === 'openai'
                    ? 'text-embedding-3-small'
                    : 'e.g. text-embedding-nomic-embed-text-v1.5'
                }
              />
              <span className="assistant-note">
                {draft.provider === 'openai'
                  ? 'Notes are embedded via the OpenAI API when the assistant searches your library (a small per-note cost, cached until a note changes).'
                  : 'Requires an embedding model loaded in LM Studio — runs fully locally. If unavailable, search falls back to keyword matching.'}
              </span>
            </label>
          )}
        </>
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
          {sharing === 'server' ? (
            <>
              Your API key is kept on your Deckle server, so every device that signs in
              to this library can use it, and sent to the provider from this browser.
              For maximum privacy, use the local LM Studio option.
            </>
          ) : sharing === 'needs-password' ? (
            <>
              Your API key is stored only in this browser and sent directly to the
              provider. To share it with your other devices, set{' '}
              <code>DECKLE_PASSWORD</code> on your server — without one, anyone who can
              reach it could read the key back.
            </>
          ) : (
            <>
              Your API key is stored only in this browser and sent directly to the
              provider. For maximum privacy, use the local LM Studio option.
            </>
          )}
        </p>
      )}

      {settingsError && <p className="assistant-error">{settingsError}</p>}

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
  view,
  onViewChange,
  sharing,
  settingsError,
  messages,
  status,
  pending,
  onSend,
  onApprove,
  onReject,
  onApproveAll,
  onStop,
  onClear,
  queue,
  onOpenRun,
  onOpenNote,
}: AssistantPanelProps) {
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const setView = onViewChange
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

  // A job queued without a provider fails alone in the background, where the
  // error is easy to miss — so the button says no instead.
  const configured = isConfigured(settings, settings.provider)
  const queueCounts = groupRuns(queue.runs)

  const submit = () => {
    if (!input.trim() || busy) return
    onSend(input)
    setInput('')
    setMention(null)
    // The answer arrives in the conversation, so that is where to be.
    setView('chat')
  }

  /**
   * The same words, handed to the background instead of the conversation.
   *
   * Deliberately not disabled while a chat turn is in flight: "this is taking
   * a while, put the next one in the queue" is exactly when it's wanted. The
   * job is pinned to whichever model the bar above is showing.
   */
  const queueJob = () => {
    if (!input.trim() || !configured) return
    void queue.enqueue(input.trim(), activePath ?? undefined, currentSelection(settings))
    setInput('')
    setMention(null)
    // Show it landing. Queueing something and staying on the conversation is
    // how the queue became invisible in the first place.
    setView('queue')
  }

  const composer = (
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
              // Don't let the global handler also exit focus mode.
              e.stopPropagation()
              setMention(null)
              return
            }
          }
          // Enter sends, Cmd/Ctrl+Enter queues — the chord the queue's
          // own box used before it moved in here.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            queueJob()
            return
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
      <div className="assistant-actions">
        <button
          type="button"
          className="assistant-queue"
          onClick={queueJob}
          disabled={!input.trim() || !configured}
          title={
            configured
              ? `Run in the background and write into ${queue.settings.inbox} (${MOD_KEY} ⏎)`
              : 'Add a provider key in settings first'
          }
        >
          <ListPlus size={15} />
          Queue
        </button>
        {status === 'thinking' ? (
          <button className="assistant-send stop" onClick={onStop} title="Stop">
            <Square size={16} />
          </button>
        ) : (
          <button
            className="assistant-send"
            onClick={submit}
            disabled={!input.trim() || busy}
            title="Send (⏎)"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        {/* The queue is not a mode of the chat, it is the other half of the
            same panel — so it gets a tab, a count, and equal billing. */}
        <div className="assistant-views" role="tablist" aria-label="Assistant">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'chat' && !showSettings}
            className={`assistant-view-tab${
              view === 'chat' && !showSettings ? ' active' : ''
            }`}
            onClick={() => {
              setView('chat')
              setShowSettings(false)
            }}
          >
            <Sparkles size={14} /> Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'queue' && !showSettings}
            className={`assistant-view-tab${
              view === 'queue' && !showSettings ? ' active' : ''
            }`}
            onClick={() => {
              setView('queue')
              setShowSettings(false)
            }}
          >
            <ListPlus size={14} /> Queue
            {queueCounts.live > 0 && (
              <span className="assistant-view-count">{queueCounts.live}</span>
            )}
            {queueCounts.parked.length > 0 && (
              <span className="assistant-view-dot" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="assistant-header-actions">
          {/* Hidden, not disabled, on a model that predates adaptive thinking:
              a switch that can only produce an error is worse than no switch. */}
          {hasThinkingToggle(settings.provider, settings.models[settings.provider]) && (
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

      {!showSettings && (
        <div className="assistant-modelbar">
          <ModelPicker
            settings={settings}
            value={currentSelection(settings)}
            onChange={({ provider, model }) =>
              onUpdateSettings({
                ...settings,
                provider,
                models: { ...settings.models, [provider]: model },
              })
            }
            onOpenSettings={() => setShowSettings(true)}
            label="Model for this chat"
          />
        </div>
      )}

      {showSettings ? (
        <SettingsView
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          sharing={sharing}
          settingsError={settingsError}
          onDone={() => setShowSettings(false)}
        />
      ) : view === 'queue' ? (
        <>
          <QueueView queue={queue} onOpenRun={onOpenRun} onOpenNote={onOpenNote} />
          {composer}
        </>
      ) : (
        <>
          <div className="assistant-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="assistant-empty">
                <Sparkles size={26} />
                <p>
                  Ask me to summarize, reorganize, draft, or edit your notes. I can read
                  the whole library and propose changes for your approval.
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
                  Or <strong>Queue</strong> it instead of sending, and I'll work in the
                  background while you write — into <code>{queue.settings.inbox}</code>.
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
              // An assistant turn can be reasoning-only (no answer text, just
              // tool calls that render as their own chips) — don't draw a blank
              // bubble in that case.
              if (!m.content && !m.reasoning) return null
              return (
                <div key={m.id} className={`msg msg-assistant${m.isError ? ' error' : ''}`}>
                  {m.reasoning && (
                    <details className="msg-reasoning">
                      <summary>Thought process</summary>
                      <div className="msg-reasoning-body">{m.reasoning}</div>
                    </details>
                  )}
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

          {/* Ambient, not intrusive: while you are chatting, one line is enough
              to know the background is busy — and the way through to it. */}
          <QueueTicker queue={queue} onShow={() => setView('queue')} />

          {composer}
        </>
      )}
    </aside>
  )
}
