// One control for "which model is doing this", used by the chat panel and by
// the queue's compose box.
//
// It lists provider *and* model together, because the two are one decision:
// "run this on Haiku" and "run this locally instead" are the same kind of
// thought, and making the second one a trip to a settings screen was the
// reason nobody changed models. Only providers you have actually configured
// appear — a key, or a URL for the local server.

import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import { CUSTOM_MODEL, MODELS, fetchLocalModels, modelLabel } from '../ai/models'
import type { AssistantSettings, Provider } from '../ai/types'

/** Provider order in the menu, and what each is called. */
export const PROVIDER_LABEL: Record<Provider, string> = {
  lmstudio: 'Local (LM Studio)',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

/** Is there enough in the settings for this provider to answer at all? */
export function isConfigured(settings: AssistantSettings, provider: Provider): boolean {
  return provider === 'lmstudio' ? !!settings.lmstudioUrl : !!settings[`${provider}Key`]
}

/** The provider/model pair a chat or a run is using. */
export interface ModelSelection {
  provider: Provider
  model: string
}

/** The model a fresh chat or run should use: whatever the settings say. */
export function currentSelection(settings: AssistantSettings): ModelSelection {
  return { provider: settings.provider, model: settings.models[settings.provider] }
}

const SETTINGS_VALUE = '__settings__'
const encode = (provider: Provider, model: string) => `${provider}::${model}`

/**
 * What a local server is serving, asked once per URL.
 *
 * Module-level rather than per-component so the chat picker and the queue
 * picker don't each go and ask; a local server is a slow enough round trip on
 * a cold start to be worth not doing twice.
 */
const localCache = new Map<string, string[]>()

function useLocalModels(url: string, enabled: boolean): string[] {
  const [models, setModels] = useState<string[]>(() => localCache.get(url) ?? [])

  useEffect(() => {
    if (!enabled || !url || localCache.has(url)) return
    const controller = new AbortController()
    void fetchLocalModels(url, controller.signal).then((found) => {
      if (controller.signal.aborted) return
      localCache.set(url, found)
      setModels(found)
    })
    return () => controller.abort()
  }, [url, enabled])

  return models
}

export default function ModelPicker({
  settings,
  value,
  onChange,
  onOpenSettings,
  disabled,
  label = 'Model',
}: {
  settings: AssistantSettings
  value: ModelSelection
  onChange: (next: ModelSelection) => void
  /** Offered as the last entry, for everything the shortlist doesn't cover. */
  onOpenSettings?: () => void
  disabled?: boolean
  /** Accessible name — the visible text is the model itself. */
  label?: string
}) {
  const localModels = useLocalModels(settings.lmstudioUrl, isConfigured(settings, 'lmstudio'))

  // The selected provider is always listed, configured or not: a picker that
  // hides what it is currently set to explains nothing.
  const providers = (Object.keys(PROVIDER_LABEL) as Provider[]).filter(
    (p) => isConfigured(settings, p) || p === value.provider,
  )

  const optionsFor = (provider: Provider): { id: string; label: string }[] => {
    const listed =
      provider === 'lmstudio' && localModels.length
        ? localModels.map((id) => ({ id, label: id }))
        : MODELS[provider].map((m) => ({ id: m.id, label: m.label }))
    // Whatever is selected belongs in the list even when it isn't one of ours —
    // a custom id typed in settings, or a local model that has since unloaded.
    const selected = provider === value.provider ? value.model : settings.models[provider]
    return listed.some((o) => o.id === selected) || !selected
      ? listed
      : [...listed, { id: selected, label: selected }]
  }

  return (
    <label className="model-picker">
      <Cpu size={13} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
      <select
        value={encode(value.provider, value.model)}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === SETTINGS_VALUE) {
            onOpenSettings?.()
            return
          }
          const [provider, ...rest] = e.target.value.split('::')
          onChange({ provider: provider as Provider, model: rest.join('::') })
        }}
      >
        {providers.map((provider) => (
          <optgroup key={provider} label={PROVIDER_LABEL[provider]}>
            {optionsFor(provider).map((option) => (
              <option key={option.id} value={encode(provider, option.id)}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
        {onOpenSettings && (
          <optgroup label="—">
            <option value={SETTINGS_VALUE}>Assistant settings…</option>
          </optgroup>
        )}
      </select>
    </label>
  )
}

/** The one-line description of a selection, for a run row or a transcript. */
export function describeSelection(selection: ModelSelection): string {
  return modelLabel(selection.provider, selection.model)
}

/**
 * The model row inside the settings screen: the same shortlist, plus the
 * free-text field Deckle has always had, revealed by picking "Custom…".
 *
 * Kept beside the picker rather than in the panel so both read the same
 * catalogue and the same live list from a local server.
 */
export function ModelField({
  settings,
  provider,
  value,
  onChange,
}: {
  settings: AssistantSettings
  provider: Provider
  value: string
  onChange: (model: string) => void
}) {
  const localModels = useLocalModels(
    settings.lmstudioUrl,
    provider === 'lmstudio' && !!settings.lmstudioUrl,
  )
  const options =
    provider === 'lmstudio' && localModels.length
      ? localModels.map((id) => ({ id, label: id, note: undefined }))
      : MODELS[provider]

  const listed = options.some((o) => o.id === value)
  // Sticky, so clearing the box to type a new id doesn't snap the select back
  // to the shortlist mid-keystroke.
  const [typing, setTyping] = useState(false)
  const custom = typing || (!!value && !listed)
  const note = options.find((o) => o.id === value)?.note

  return (
    <>
      <label className="field">
        <span>Model</span>
        <select
          value={custom ? CUSTOM_MODEL : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM_MODEL) {
              setTyping(true)
              return
            }
            setTyping(false)
            onChange(e.target.value)
          }}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          <option value={CUSTOM_MODEL}>Custom…</option>
        </select>
        {note && <span className="assistant-note">{note}</span>}
      </label>
      {custom && (
        <label className="field">
          <span>Model id</span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              provider === 'lmstudio'
                ? 'The id LM Studio shows for the loaded model'
                : 'Any model id this provider accepts'
            }
          />
          <span className="assistant-note">
            {provider === 'lmstudio'
              ? "Anything the local server answers to. Deckle lists what it's serving when it can reach it."
              : 'The list above is a shortlist, not a limit — any id the provider accepts works here.'}
          </span>
        </label>
      )}
    </>
  )
}
