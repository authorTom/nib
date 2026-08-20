// The models Deckle offers per provider, and how to ask a local server what it
// has loaded.
//
// A short, opinionated shortlist rather than a catalogue: the point is to pick
// a model without leaving the panel, and a hundred entries is not a picker.
// Anything not listed is still reachable — every provider keeps a "Custom…"
// entry that reveals the free-text field, which is what Deckle had before this
// and remains the escape hatch when a provider ships something new.

import type { Provider } from './types'

export interface ModelChoice {
  /** The id sent to the provider. */
  id: string
  /** What it's called in the picker. */
  label: string
  /** One short line: what it is for. */
  note?: string
  /**
   * Whether the model takes Claude's adaptive thinking parameter. Models from
   * before 4.6 reject it, so the thinking toggle hides itself rather than
   * offering a switch that turns every message into a 400.
   */
  thinking?: boolean
}

/**
 * Sentinel for "let me type an id". Not a model id, and never sent anywhere —
 * picking it only reveals the text field.
 */
export const CUSTOM_MODEL = '__custom__'

export const MODELS: Record<Provider, ModelChoice[]> = {
  anthropic: [
    {
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      note: 'Most capable. Best for long, multi-step jobs.',
      thinking: true,
    },
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      note: 'Faster and cheaper. A good default for everyday editing.',
      thinking: true,
    },
    {
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      note: 'Fastest and cheapest. Short, well-defined jobs.',
      // Pre-4.6, so adaptive thinking is not available on it.
      thinking: false,
    },
    {
      id: 'claude-opus-4-8',
      label: 'Claude Opus 4.8',
      note: 'The previous Opus. Kept for libraries already set to it.',
      thinking: true,
    },
  ],
  openai: [
    { id: 'gpt-5.1', label: 'GPT-5.1', note: 'The capable general model.' },
    { id: 'gpt-5.1-mini', label: 'GPT-5.1 mini', note: 'Faster and cheaper.' },
    { id: 'gpt-4o', label: 'GPT-4o', note: 'Older, widely available.' },
  ],
  openrouter: [
    {
      id: 'openrouter/auto',
      label: 'Auto',
      note: 'OpenRouter picks a capable model for the prompt.',
    },
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'openai/gpt-5.1', label: 'GPT-5.1' },
  ],
  // Filled in from the local server, which is the only thing that knows what
  // has actually been downloaded and loaded. This entry is the fallback shown
  // before that answers, or when it can't be reached.
  lmstudio: [{ id: 'local-model', label: 'Whatever is loaded', note: 'The model LM Studio is serving.' }],
}

/** The catalogue entry for an id, or null when the user typed their own. */
export function findModel(provider: Provider, id: string): ModelChoice | null {
  return MODELS[provider].find((m) => m.id === id) ?? null
}

/** What to show for a model: its friendly name, or the raw id if we don't know it. */
export function modelLabel(provider: Provider, id: string): string {
  return findModel(provider, id)?.label ?? id
}

/**
 * Is the thinking toggle worth showing for this provider and model?
 *
 * Only where it actually changes the request. Every provider spells reasoning
 * differently: Claude has adaptive thinking, LM Studio passes a flag to the
 * model's chat template, and OpenRouter has a unified `reasoning` object it
 * maps onto whichever model it routes to. OpenAI is the exception — its
 * `reasoning_effort` is accepted only by its reasoning models and is an error
 * on the rest, so there is no honest switch to offer for "OpenAI" as a whole.
 */
export function hasThinkingToggle(provider: Provider, model: string): boolean {
  if (provider === 'openai') return false
  return supportsThinking(provider, model)
}

/**
 * Does this model take Claude's adaptive thinking parameter?
 *
 * Unknown ids answer yes: a model we have never heard of is more likely to be
 * newer than the list than older than it, and the toggle is the user's to
 * switch off if the provider disagrees.
 */
export function supportsThinking(provider: Provider, id: string): boolean {
  if (provider !== 'anthropic') return true
  return findModel(provider, id)?.thinking ?? true
}

/**
 * Ask a local LM Studio server which models it is serving.
 *
 * Its list is the only one worth having: a static list of local models is a
 * list of what someone else downloaded. Returns [] on any failure — no server
 * running, CORS switched off, a URL pointing at nothing — and the picker falls
 * back to the free-text field rather than showing an error nobody asked for.
 */
export async function fetchLocalModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return []
    const body = (await res.json()) as { data?: { id?: unknown }[] }
    return (body.data ?? [])
      .map((m) => (typeof m.id === 'string' ? m.id : ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
