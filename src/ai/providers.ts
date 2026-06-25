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
  const toolCalls: ProviderTurn['toolCalls'] = []
  for (const block of resp.content ?? []) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} })
    }
  }
  return { text, toolCalls, raw: resp.content }
}

// ---- OpenAI-compatible (OpenAI + LM Studio) --------------------------------

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
): Promise<ProviderTurn> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const body = {
    model,
    messages: toOpenAIMessages(system, history),
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    tool_choice: 'auto',
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
  return { text: msg.content ?? '', toolCalls }
}

// ---- Dispatch --------------------------------------------------------------

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
  if (settings.provider === 'openai') {
    if (!settings.openaiKey) throw new Error('Add your OpenAI API key in settings.')
    return runOpenAICompatible(
      'https://api.openai.com/v1',
      settings.openaiKey,
      settings.models.openai || 'gpt-4o',
      system,
      history,
      tools,
      signal,
    )
  }
  // LM Studio (local, no key)
  return runOpenAICompatible(
    settings.lmstudioUrl || 'http://localhost:1234/v1',
    '',
    settings.models.lmstudio || 'local-model',
    system,
    history,
    tools,
    signal,
  )
}
