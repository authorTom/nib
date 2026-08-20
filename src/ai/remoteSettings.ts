// The assistant's settings, kept on the server so they follow you between
// devices.
//
// Settings live in localStorage by default, which is right for a library that
// lives on this machine — but a server library is reachable from anywhere, and
// re-typing the API key on every device is not what "your notes are wherever
// you are" should mean. So when a server library is open, the server holds the
// settings and this browser is a cache of them.
//
// What travels is everything *except* the LM Studio URL: that one usually
// points at localhost, where a different machine has something else — or
// nothing at all.

import { APP_HEADERS } from '../fs/remote'
import type { AssistantSettings } from './types'

const ENDPOINT = '/api/assistant-settings'

/** Every setting that means the same thing on any device. */
export type SharedSettings = Omit<AssistantSettings, 'lmstudioUrl'>

/**
 * Why this browser is or isn't sharing its assistant settings.
 *
 * 'needs-password' is the interesting one: the server *could* hold them, but
 * it has no password set, so it refuses to store a provider key that anyone
 * who can reach the port could then read back.
 */
export type Sharing = 'server' | 'needs-password' | 'local'

/**
 * Split a settings object into the part that travels.
 *
 * Written as an explicit omission rather than a list of fields to copy, so a
 * setting added to AssistantSettings later travels by default instead of being
 * silently left behind on one machine.
 */
export function pickShared(settings: AssistantSettings): SharedSettings {
  const { lmstudioUrl: _lmstudioUrl, ...shared } = settings
  return shared
}

/** Lay the server's copy over this browser's, keeping what is device-local. */
export function mergeShared(
  local: AssistantSettings,
  shared: Partial<SharedSettings>,
): AssistantSettings {
  return {
    ...local,
    ...shared,
    // Nested, so a spread would replace the whole map and drop any model id
    // the server's copy happens not to carry.
    models: { ...local.models, ...(shared.models ?? {}) },
    lmstudioUrl: local.lmstudioUrl,
  }
}

async function call(init: RequestInit = {}): Promise<Response> {
  return await fetch(ENDPOINT, {
    ...init,
    credentials: 'same-origin',
    headers: { ...APP_HEADERS, ...(init.headers ?? {}) },
  })
}

/**
 * The settings this server is holding.
 *
 * Returns null when it has none yet — a fresh server, which the caller answers
 * by seeding it from whatever this browser already has.
 */
export async function loadShared(): Promise<Partial<SharedSettings> | null> {
  const res = await call()
  if (!res.ok) throw new Error(await describe(res))
  const body = (await res.json()) as { settings: Partial<SharedSettings> | null }
  return body.settings ?? null
}

export async function saveShared(settings: SharedSettings): Promise<void> {
  const res = await call({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
  if (!res.ok) throw new Error(await describe(res))
}

/** The server's own words where it has them, and something plain where it doesn't. */
async function describe(res: Response): Promise<string> {
  const body = (await res
    .json()
    .catch(() => ({}))) as { error?: string; message?: string }
  if (body.message) return body.message
  if (res.status === 401) return 'Signed out of the server — sign in again to save settings.'
  return body.error ?? `The server refused the settings (${res.status}).`
}
