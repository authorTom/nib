import Anthropic from '@anthropic-ai/sdk'
import type {
  AssistantSettings,
  ChatMessage,
  ProviderTurn,
  ToolDef,
} from './types'

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return {}
  }
}

/**
 * Split a reasoning model's output into its chain-of-thought and its answer.
 * Handles complete <think>…</think> blocks, a leading dangling close tag (the
 * model started reasoning immediately), and an unclosed <think> (reasoning that
 * was truncated or never closed). Returning the reasoning instead of discarding
 * it means a turn that is *all* thinking no longer renders as a blank bubble.
 */
function splitThink(text: string): { reasoning: string; answer: string } {
  const parts: string[] = []
  let answer = (text ?? '').replace(
    /<think>([\s\S]*?)<\/think>/gi,
    (_m, r: string) => {
      parts.push(r)
      return ''
    },
  )
  // Reasoning emitted first with only a closing tag (no opening <think>).
  const close = answer.indexOf('</think>')
  if (close !== -1 && !answer.includes('<think>')) {
    parts.unshift(answer.slice(0, close))
    answer = answer.slice(close + '</think>'.length)
  }
  // Reasoning that was opened but never closed (truncated / still-open block).
  const open = answer.indexOf('<think>')
  if (open !== -1) {
    parts.push(answer.slice(open + '<think>'.length))
    answer = answer.slice(0, open)
  }
  return { reasoning: parts.join('\n\n').trim(), answer: answer.trim() }
}

// ---- Anthropic (official SDK) ----------------------------------------------

// Build Anthropic message blocks from our normalized history, merging
// consecutive tool results into a single user turn.
function toAnthropicMessages(history: ChatMessage[]): unknown[] {
  const messages: unknown[] = []
  let toolResults: unknown[] = []
  const flush = () => {
    if (toolResults.length) {
      messages.push({ role: 'user', content: toolResults })
      toolResults = []
    }
  }
  for (const m of history) {
    if (m.role === 'tool') {
      toolResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      })
      continue
    }
    flush()
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content })
    } else if (m.providerRaw) {
      // Resend Claude's native blocks verbatim (preserves thinking + signatures).
      messages.push({ role: 'assistant', content: m.providerRaw })
    } else {
      const content: unknown[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      }
      messages.push({ role: 'assistant', content })
    }
  }
  flush()
  return messages
}

async function runAnthropic(
  settings: AssistantSettings,
  system: string,
  history: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
): Promise<ProviderTurn> {
  if (!settings.anthropicKey) throw new Error('Add your Anthropic API key in settings.')
  const client = new Anthropic({
    apiKey: settings.anthropicKey,
    dangerouslyAllowBrowser: true,
  })
  const params: Record<string, unknown> = {
    model: settings.models.anthropic || 'claude-opus-4-8',
    max_tokens: 8000,
    system,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
    messages: toAnthropicMessages(history),
  }
  // Extended ("adaptive") thinking — omit entirely when toggled off.
  if (settings.thinking) params.thinking = { type: 'adaptive' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await client.messages.create(params as any, { signal })
  let text = ''
  let reasoning = ''
  const toolCalls: ProviderTurn['toolCalls'] = []
  for (const block of resp.content ?? []) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'thinking') reasoning += block.thinking ?? ''
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} })
    }
  }
  return { text, toolCalls, raw: resp.content, reasoning: reasoning.trim() || undefined }
}

// ---- OpenAI-compatible (OpenAI + OpenRouter + LM Studio) -------------------

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
// Optional ranking/attribution headers recommended by OpenRouter. "HTTP-Referer"
// (not the browser-forbidden "Referer") and "X-Title" are safe to set from fetch.
const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/authorTom/nib',
  'X-Title': 'Nib',
}

interface CompatibleConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Local (LM Studio): toggle reasoning via a chat-template flag rather than a key. */
  isLocal: boolean
  /** Strip <think>…</think> blocks from the visible answer (reasoning models). */
  stripThink: boolean
  /** Extra request headers (OpenRouter attribution). */
  extraHeaders?: Record<string, string>
}

/** Resolve the OpenAI-compatible endpoint config for the active provider
 *  (everything except Anthropic, which uses its own SDK). */
function resolveCompatible(settings: AssistantSettings): CompatibleConfig {
  switch (settings.provider) {
    case 'openai':
      return {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: settings.openaiKey,
        model: settings.models.openai || 'gpt-4o',
        isLocal: false,
        stripThink: false,
      }
    case 'openrouter':
      return {
        baseUrl: OPENROUTER_BASE,
        apiKey: settings.openrouterKey,
        model: settings.models.openrouter || 'openrouter/auto',
        isLocal: false,
        stripThink: true,
        extraHeaders: OPENROUTER_HEADERS,
      }
    default: // lmstudio
      return {
        baseUrl: settings.lmstudioUrl || 'http://localhost:1234/v1',
        apiKey: '',
        model: settings.models.lmstudio || 'local-model',
        isLocal: true,
        stripThink: true,
      }
  }
}

/** Error message if the active OpenAI-compatible provider is missing its key. */
function compatibleKeyError(settings: AssistantSettings): string | null {
  if (settings.provider === 'openai' && !settings.openaiKey) {
    return 'Add your OpenAI API key in settings.'
  }
  if (settings.provider === 'openrouter' && !settings.openrouterKey) {
    return 'Add your OpenRouter API key in settings.'
  }
  return null
}


function toOpenAIMessages(system: string, history: ChatMessage[]): unknown[] {
  const messages: unknown[] = [{ role: 'system', content: system }]
  for (const m of history) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content })
    } else if (m.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    } else {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || '' }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
      }
      messages.push(msg)
    }
  }
  return messages
}

async function runOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  history: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
  opts: {
    extra?: Record<string, unknown>
    stripThink?: boolean
    extraHeaders?: Record<string, string>
  } = {},
): Promise<ProviderTurn> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.extraHeaders ?? {}),
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const body = {
    model,
    messages: toOpenAIMessages(system, history),
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    tool_choice: 'auto',
    ...(opts.extra ?? {}),
  }
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Request failed (${resp.status}). ${detail.slice(0, 300)}`)
  }
  const data = await resp.json()
  const msg = data.choices?.[0]?.message ?? {}
  const toolCalls: ProviderTurn['toolCalls'] = (msg.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParse(tc.function.arguments),
    }),
  )
  let text = msg.content ?? ''
  // Reasoning models expose their chain-of-thought either in a dedicated field
  // (OpenRouter / LM Studio) or inline as a <think> block in the content.
  let reasoning = String(msg.reasoning ?? msg.reasoning_content ?? '')
  if (opts.stripThink) {
    const split = splitThink(text)
    text = split.answer
    if (!reasoning) reasoning = split.reasoning
  }
  return { text, toolCalls, reasoning: reasoning.trim() || undefined }
}

// ---- Dispatch --------------------------------------------------------------

/**
 * One-shot completion (no tools) — used by the inline "Ask AI" popover to
 * transform or answer questions about a text selection.
 */
export async function runCompletion(
  settings: AssistantSettings,
  system: string,
  userText: string,
  signal: AbortSignal,
): Promise<string> {
  if (settings.provider === 'anthropic') {
    if (!settings.anthropicKey) throw new Error('Add your Anthropic API key in settings.')
    const client = new Anthropic({
      apiKey: settings.anthropicKey,
      dangerouslyAllowBrowser: true,
    })
    const params: Record<string, unknown> = {
      model: settings.models.anthropic || 'claude-opus-4-8',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userText }],
    }
    if (settings.thinking) params.thinking = { type: 'adaptive' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await client.messages.create(params as any, { signal })
    return (resp.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
      .trim()
  }

  const keyError = compatibleKeyError(settings)
  if (keyError) throw new Error(keyError)
  const cfg = resolveCompatible(settings)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(cfg.extraHeaders ?? {}),
  }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ],
  }
  if (cfg.isLocal) body.chat_template_kwargs = { enable_thinking: settings.thinking }

  const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Request failed (${resp.status}). ${detail.slice(0, 300)}`)
  }
  const data = await resp.json()
  let text = data.choices?.[0]?.message?.content ?? ''
  if (cfg.stripThink) text = splitThink(text).answer
  return text.trim()
}

export async function runTurn(
  settings: AssistantSettings,
  system: string,
  history: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
): Promise<ProviderTurn> {
  if (settings.provider === 'anthropic') {
    return runAnthropic(settings, system, history, tools, signal)
  }
  // Everything else (OpenAI, OpenRouter, LM Studio) speaks the OpenAI wire
  // format. LM Studio toggles reasoning via a chat-template flag; cloud
  // reasoning models instead emit <think> blocks we strip from the answer.
  const keyError = compatibleKeyError(settings)
  if (keyError) throw new Error(keyError)
  const cfg = resolveCompatible(settings)
  return runOpenAICompatible(
    cfg.baseUrl,
    cfg.apiKey,
    cfg.model,
    system,
    history,
    tools,
    signal,
    {
      extra: cfg.isLocal
        ? { chat_template_kwargs: { enable_thinking: settings.thinking } }
        : undefined,
      stripThink: cfg.stripThink,
      extraHeaders: cfg.extraHeaders,
    },
  )
}
