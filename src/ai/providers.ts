import Anthropic from '@anthropic-ai/sdk'
import { supportsThinking } from './models'
import type { Provider } from './types'
import type {
  AssistantSettings,
  ChatMessage,
  ProviderTurn,
  ToolDef,
} from './types'

/**
 * Called as tokens arrive, with the whole visible answer so far rather than the
 * latest fragment. A snapshot is what every consumer here actually wants — a
 * React bubble sets its state to it, and a `<think>` block that turns out to be
 * reasoning can be split back out of it — and it removes any chance of two
 * callers disagreeing about what has been delivered.
 */
export type OnText = (snapshot: string) => void

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

function anthropicClient(settings: AssistantSettings): Anthropic {
  if (!settings.anthropicKey) throw new Error('Add your Anthropic API key in settings.')
  return new Anthropic({
    apiKey: settings.anthropicKey,
    dangerouslyAllowBrowser: true,
  })
}

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

/**
 * Accumulate a streamed Anthropic response into the shape a non-streamed one
 * has, so everything downstream — including resending `raw` verbatim — is
 * unchanged by the switch to streaming.
 *
 * Written here rather than handed to the SDK's `messages.stream()` helper: the
 * pinned SDK (0.32) accumulates only `text_delta` and `input_json_delta`, so a
 * thinking block would come back with empty text *and no signature* — and an
 * unsigned thinking block resent on the next turn is a 400. The raw event
 * stream carries every delta type, so accumulating it ourselves is the only
 * version-proof way to keep extended thinking working.
 */
interface StreamedBlock {
  type: string
  text?: string
  thinking?: string
  signature?: string
  id?: string
  name?: string
  input?: unknown
  [key: string]: unknown
}

async function runAnthropic(
  settings: AssistantSettings,
  system: string,
  history: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
  onText?: OnText,
): Promise<ProviderTurn> {
  const client = anthropicClient(settings)
  const params: Record<string, unknown> = {
    model: settings.models.anthropic || 'claude-opus-5',
    max_tokens: 8000,
    system,
    stream: true,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
    messages: toAnthropicMessages(history),
  }
  // Extended ("adaptive") thinking — omit entirely when toggled off. Without
  // display: 'summarized', recent models return thinking blocks with empty
  // text (display defaults to "omitted"), leaving the reasoning UI blank.
  //
  // Also omitted for models that predate adaptive thinking: they reject the
  // parameter outright, and a stored preference should not turn every message
  // on such a model into a 400 just because it was switched on for another.
  if (settings.thinking && supportsThinking('anthropic', settings.models.anthropic)) {
    params.thinking = { type: 'adaptive', display: 'summarized' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await client.messages.create(params as any, { signal })

  const blocks: StreamedBlock[] = []
  // Tool arguments arrive as JSON fragments; keep the raw string per block and
  // parse once at the end, because a half-sent object doesn't parse.
  const toolJson = new Map<number, string>()
  let text = ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const event of stream as AsyncIterable<any>) {
    if (event.type === 'content_block_start') {
      blocks[event.index] = { ...event.content_block }
      continue
    }
    if (event.type !== 'content_block_delta') continue
    const block = blocks[event.index]
    if (!block) continue
    switch (event.delta?.type) {
      case 'text_delta':
        block.text = (block.text ?? '') + event.delta.text
        text += event.delta.text
        onText?.(text)
        break
      case 'thinking_delta':
        block.thinking = (block.thinking ?? '') + event.delta.thinking
        break
      case 'signature_delta':
        block.signature = (block.signature ?? '') + event.delta.signature
        break
      case 'input_json_delta':
        toolJson.set(event.index, (toolJson.get(event.index) ?? '') + event.delta.partial_json)
        break
    }
  }

  // The SDK's SSE iterator *returns* on abort rather than throwing, so without
  // this a stopped turn would come back looking like a finished one — and the
  // loop would go on to execute whichever tool calls had arrived so far.
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')

  let reasoning = ''
  const toolCalls: ProviderTurn['toolCalls'] = []
  blocks.forEach((block, index) => {
    if (block.type === 'thinking') reasoning += block.thinking ?? ''
    else if (block.type === 'tool_use') {
      block.input = safeParse(toolJson.get(index) ?? '')
      toolCalls.push({
        id: String(block.id),
        name: String(block.name),
        arguments: block.input as Record<string, unknown>,
      })
    }
  })
  return {
    text,
    toolCalls,
    // Filtered, because `blocks` is index-addressed: a gap would resend as a
    // null content block and be rejected.
    raw: blocks.filter(Boolean),
    reasoning: reasoning.trim() || undefined,
  }
}

// ---- OpenAI-compatible (OpenAI + OpenRouter + LM Studio) -------------------

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
// Optional ranking/attribution headers recommended by OpenRouter. "HTTP-Referer"
// (not the browser-forbidden "Referer") and "X-Title" are safe to set from fetch.
const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/authorTom/deckle',
  'X-Title': 'Deckle',
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
/**
 * How each OpenAI-compatible provider is asked to think, or not to.
 *
 * LM Studio takes a flag every time — it is how the local model's chat template
 * decides whether to reason at all. OpenRouter's unified `reasoning` object is
 * sent only when the toggle is on, so a model that doesn't reason is never
 * asked to. OpenAI gets nothing: see hasThinkingToggle.
 */
function thinkingParams(
  provider: Provider,
  thinking: boolean,
): Record<string, unknown> | undefined {
  if (provider === 'lmstudio') {
    return { chat_template_kwargs: { enable_thinking: thinking } }
  }
  if (provider === 'openrouter' && thinking) return { reasoning: { enabled: true } }
  return undefined
}

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


/**
 * Walk an OpenAI-style `text/event-stream` body, handing each `data:` payload
 * to the caller. Keep-alive comments and the trailing `[DONE]` are swallowed
 * here so the accumulator only ever sees chunks.
 */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onChunk(JSON.parse(payload))
      } catch {
        // A fragment, a comment, or a provider being creative — skip it rather
        // than fail a turn that is otherwise arriving fine.
      }
    }
  }
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
    onText?: OnText
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
    stream: true,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: 'auto',
        }
      : {}),
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
  if (!resp.body) throw new Error('The provider returned an empty response.')

  let raw = ''
  let reasoning = ''
  // Keyed by the `index` the provider stamps on each fragment: a model can open
  // a second tool call before it has finished sending the arguments of the first.
  const calls = new Map<number, { id: string; name: string; args: string }>()
  /** What the reader should see: the answer with any <think> block taken out. */
  const visible = () => (opts.stripThink ? splitThink(raw).answer : raw)

  await readSSE(resp.body, (chunk) => {
    const choice = (chunk.choices as { delta?: Record<string, unknown> }[] | undefined)?.[0]
    const delta = choice?.delta
    if (!delta) return
    if (typeof delta.content === 'string' && delta.content) {
      raw += delta.content
      opts.onText?.(visible())
    }
    const think = delta.reasoning ?? delta.reasoning_content
    if (typeof think === 'string') reasoning += think
    for (const tc of (delta.tool_calls ?? []) as {
      index?: number
      id?: string
      function?: { name?: string; arguments?: string }
    }[]) {
      const index = tc.index ?? 0
      const acc = calls.get(index) ?? { id: '', name: '', args: '' }
      if (tc.id) acc.id = tc.id
      if (tc.function?.name) acc.name = tc.function.name
      if (tc.function?.arguments) acc.args += tc.function.arguments
      calls.set(index, acc)
    }
  })

  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')

  const toolCalls: ProviderTurn['toolCalls'] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, c]) => ({
      // LM Studio omits the id on tool calls it streams; the id only has to be
      // unique within the turn for the result to be matched back to the call.
      id: c.id || `call_${index}`,
      name: c.name,
      arguments: safeParse(c.args),
    }))

  let text = raw
  // Reasoning models expose their chain-of-thought either in a dedicated field
  // (OpenRouter / LM Studio) or inline as a <think> block in the content.
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
  onText?: OnText,
): Promise<string> {
  const turn = await runTurn(
    settings,
    system,
    [{ id: 'inline', role: 'user', content: userText }],
    [], // no tools — one-shot completion
    signal,
    onText,
  )
  return turn.text.trim()
}

export async function runTurn(
  settings: AssistantSettings,
  system: string,
  history: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
  onText?: OnText,
): Promise<ProviderTurn> {
  if (settings.provider === 'anthropic') {
    return runAnthropic(settings, system, history, tools, signal, onText)
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
      extra: thinkingParams(settings.provider, settings.thinking),
      stripThink: cfg.stripThink,
      extraHeaders: cfg.extraHeaders,
      onText,
    },
  )
}
