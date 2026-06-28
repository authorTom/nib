import type { AssistantSettings } from './types'

const STORAGE_KEY = 'nib-assistant-settings'

export const DEFAULT_SETTINGS: AssistantSettings = {
  provider: 'lmstudio',
  anthropicKey: '',
  openaiKey: '',
  openrouterKey: '',
  lmstudioUrl: 'http://localhost:1234/v1',
  models: {
    anthropic: 'claude-opus-4-8',
    openai: 'gpt-4o',
    // OpenRouter's auto-router picks a capable model — a safe always-valid default.
    openrouter: 'openrouter/auto',
    lmstudio: 'local-model',
  },
  thinking: true,
  systemPrompt: '',
}

export function loadSettings(): AssistantSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      models: { ...DEFAULT_SETTINGS.models, ...(parsed.models ?? {}) },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AssistantSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore quota / disabled storage
  }
}
