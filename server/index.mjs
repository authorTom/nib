// Deckle server: serves the built SPA and, optionally, a server-side library.
//
// Deckle is still a local-first app — by default it stores notes in a folder you
// pick or privately in the browser, and this process is then nothing more than
// a static file server. Mount a volume and the same process also offers a
// *server library*: real .md files living in the container, so the app works from
// any device with no local storage at all.
//
// The server library is opt-in: without DECKLE_SERVER_LIBRARY=true this process
// is a pure static file server and the image behaves exactly as it always has.
// That default matters — enabling it implicitly would offer people a library
// that silently disappears with the container unless they also mounted a volume.
//
// Configuration (all optional):
//   PORT                     port to listen on                  (default 8080)
//   DECKLE_SERVER_LIBRARY    "true" enables the server library     (default off)
//   DECKLE_LIBRARY_DIR       directory holding the server library (default /data)
//   DECKLE_STATE_DIR         Deckle's own state, outside the library
//                            (default <DECKLE_LIBRARY_DIR>/.deckle-state)
//   DECKLE_LIBRARY_NAME      display name shown in the app  (default "My Notes")
//   DECKLE_PASSWORD          password gating the library; unset = open access
//   DECKLE_SESSION_SECRET    keeps sessions valid across restarts
//   DECKLE_SESSION_TTL_DAYS  session lifetime                     (default 30)
//   DECKLE_API_TOKENS        bearer tokens enabling the /api/v1 machine API
//   DECKLE_API_CORS_ORIGINS  origins allowed to call /api/v1 from a browser
//
// The NIB_* names these replaced are still honoured; see legacy-env.mjs.

import http from 'node:http'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth.mjs'
import { createApiAuth } from './api-auth.mjs'
import { createApi } from './api.mjs'
import { createSearch } from './search.mjs'
import { createStaticHandler, SECURITY_HEADERS } from './static.mjs'
import { createLibraryApi, TooLargeError } from './library-api.mjs'
import { createLibraryStore } from './library-store.mjs'
import { createSettingsStore, InvalidSettingsError, MAX_SETTINGS_BYTES } from './settings-store.mjs'
import { BadPathError } from './paths.mjs'
import { resolveLegacyEnv } from './legacy-env.mjs'
import { VERSION } from './version.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

// Read configuration through the compatibility shim, never from process.env
// directly, so a .env written before the rename still configures this server.
const { env: ENV, honoured: LEGACY_ENV } = resolveLegacyEnv(process.env)

const PORT = Number(ENV.PORT || 8080)
const PUBLIC_DIR = path.resolve(ENV.DECKLE_PUBLIC_DIR || path.join(here, '..', 'dist'))
const LIBRARY_DIR = path.resolve(ENV.DECKLE_LIBRARY_DIR || '/data')
const LIBRARY_NAME = ENV.DECKLE_LIBRARY_NAME || 'My Notes'
const LIBRARY_ENABLED = ENV.DECKLE_SERVER_LIBRARY === 'true'
// Deckle's own state — not notes, and not part of the library, but kept under
// the library directory by default because that is the volume people mount.
// The library API refuses to serve it; see RESERVED_DIR in library-api.mjs.
const STATE_DIR = path.resolve(
  ENV.DECKLE_STATE_DIR || path.join(LIBRARY_DIR, '.deckle-state'),
)

const auth = createAuth(ENV)
const library = createLibraryApi(LIBRARY_DIR)
const settingsStore = createSettingsStore(STATE_DIR)

// Shared assistant settings are offered only behind a password. Without one the
// API is open by design (the deployment guide assumes a VPN or an
// authenticating proxy in front), and an open endpoint handing out a provider
// key is not a trade this server gets to make on the user's behalf.
const SHARED_SETTINGS = LIBRARY_ENABLED && auth.required
const serveStatic = createStaticHandler(PUBLIC_DIR)

// The machine API (/api/v1): off unless tokens are configured, and useless
// without the server library, since a local-folder library never reaches this
// process at all.
const apiAuth = createApiAuth(ENV)
const handleApi = createApi({
  library,
  store: createLibraryStore(library),
  search: createSearch(library),
  auth: apiAuth,
  libraryEnabled: LIBRARY_ENABLED,
  libraryName: LIBRARY_NAME,
  corsOrigins: (ENV.DECKLE_API_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
})

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

async function readJsonBody(req, limit = 4096) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new TooLargeError('body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Second CSRF layer behind the SameSite=Strict cookie: a custom header the
 * browser will only send same-origin, because we serve no CORS headers so any
 * cross-origin preflight fails. A form post or img tag from another site can't
 * set it.
 */
function hasAppHeader(req) {
  return req.headers['x-deckle-app'] === '1'
}

// ---- /api/server-library -----------------------------------------------------

async function handleServerLibraryRoutes(req, res, url) {
  if (url.pathname === '/api/server-library' && req.method === 'GET') {
    sendJson(res, 200, {
      enabled: LIBRARY_ENABLED,
      name: LIBRARY_NAME,
      authRequired: auth.required,
      authenticated: LIBRARY_ENABLED && auth.isAuthenticated(req),
      // Whether this server will hold the assistant's settings for every
      // device, so the app can say why it won't when it won't.
      sharedSettings: SHARED_SETTINGS,
    })
    return true
  }

  if (url.pathname === '/api/server-library/login' && req.method === 'POST') {
    if (!LIBRARY_ENABLED) {
      sendJson(res, 404, { error: 'server library disabled' })
      return true
    }
    if (!hasAppHeader(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return true
    }
    if (!auth.required) {
      sendJson(res, 200, { ok: true })
      return true
    }
    let body
    try {
      body = await readJsonBody(req)
    } catch {
      sendJson(res, 400, { error: 'invalid request' })
      return true
    }
    const result = auth.login(req, body.password)
    if (result.error === 'throttled') {
      sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' })
      return true
    }
    if (result.error) {
      sendJson(res, 401, { error: 'Incorrect password.' })
      return true
    }
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': result.cookie })
    return true
  }

  if (url.pathname === '/api/server-library/logout' && req.method === 'POST') {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.logoutCookie(req) })
    return true
  }

  return false
}

// ---- /api/assistant-settings -------------------------------------------------

/**
 * The assistant's settings, shared by every device signed in to this server.
 *
 * Gated exactly like the library routes — same-origin app header, then the
 * session cookie — plus the password requirement above. The stored object is
 * whatever the app sent; this endpoint is a shelf, not a schema.
 */
async function handleAssistantSettingsRoutes(req, res, url) {
  if (url.pathname !== '/api/assistant-settings') return false

  if (!LIBRARY_ENABLED) {
    sendJson(res, 404, { error: 'server library disabled' })
    return true
  }
  if (!hasAppHeader(req)) {
    sendJson(res, 403, { error: 'forbidden' })
    return true
  }
  if (!SHARED_SETTINGS) {
    sendJson(res, 409, {
      error: 'password_required',
      message:
        'Set DECKLE_PASSWORD to share assistant settings between devices. ' +
        'Without it this server is open, and anyone who can reach it could read the key.',
    })
    return true
  }
  if (!auth.isAuthenticated(req)) {
    sendJson(res, 401, { error: 'not authenticated' })
    return true
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { settings: await settingsStore.read() })
    return true
  }

  if (req.method === 'PUT') {
    let body
    try {
      body = await readJsonBody(req, MAX_SETTINGS_BYTES)
    } catch (err) {
      if (err instanceof TooLargeError) throw err
      sendJson(res, 400, { error: 'invalid request' })
      return true
    }
    try {
      await settingsStore.write(body.settings)
    } catch (err) {
      if (err instanceof InvalidSettingsError) {
        sendJson(res, 400, { error: err.message })
        return true
      }
      throw err
    }
    sendJson(res, 200, { ok: true })
    return true
  }

  sendJson(res, 405, { error: 'method not allowed' })
  return true
}

// ---- /api/library ------------------------------------------------------------

async function handleLibraryRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/library/')) return false

  if (!LIBRARY_ENABLED) {
    sendJson(res, 404, { error: 'server library disabled' })
    return true
  }
  if (!hasAppHeader(req)) {
    sendJson(res, 403, { error: 'forbidden' })
    return true
  }
  if (!auth.isAuthenticated(req)) {
    sendJson(res, 401, { error: 'not authenticated' })
    return true
  }

  const rel = url.searchParams.get('path') ?? ''
  const route = `${req.method} ${url.pathname}`

  switch (route) {
    case 'GET /api/library/tree':
      sendJson(res, 200, { tree: await library.tree(rel) })
      return true

    case 'GET /api/library/list':
      sendJson(res, 200, { entries: await library.list(rel) })
      return true

    case 'GET /api/library/stat':
      sendJson(res, 200, await library.stat(rel))
      return true

    case 'GET /api/library/file': {
      const { abs, size, lastModified } = await library.fileForRead(rel)
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        // Notes can hold anything; never let a browser render one inline.
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store',
        'Content-Length': size,
        'X-Last-Modified': String(lastModified),
      })
      createReadStream(abs).pipe(res)
      return true
    }

    case 'PUT /api/library/file': {
      const declared = Number(req.headers['content-length'] || 0)
      if (declared > library.maxFileBytes) {
        sendJson(res, 413, { error: 'file too large' })
        return true
      }
      sendJson(res, 200, await library.writeFile(rel, req))
      return true
    }

    case 'POST /api/library/dir':
      await library.mkdir(rel)
      sendJson(res, 200, { ok: true })
      return true

    case 'DELETE /api/library/entry':
      await library.remove(rel, url.searchParams.get('recursive') === '1')
      sendJson(res, 200, { ok: true })
      return true

    default:
      sendJson(res, 404, { error: 'unknown endpoint' })
      return true
  }
}

// ---- Server ----------------------------------------------------------------

const server = http.createServer((req, res) => {
  void (async () => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      sendJson(res, 400, { error: 'bad request' })
      return
    }

    try {
      // The machine API comes first: it authenticates by bearer token and must
      // never be reachable with the app's session cookie.
      if (await handleApi(req, res, url)) return
      if (await handleServerLibraryRoutes(req, res, url)) return
      if (await handleAssistantSettingsRoutes(req, res, url)) return
      if (await handleLibraryRoutes(req, res, url)) return

      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'unknown endpoint' })
        return
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      await serveStatic(req, res, url.pathname)
    } catch (err) {
      // ENOENT is the normal "this note doesn't exist yet" answer to a stat or
      // read, and the client adapter turns a 404 into the NotFoundError the
      // File System Access API would have thrown.
      if (err && err.code === 'ENOENT') {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      if (err instanceof BadPathError) {
        sendJson(res, 400, { error: err.message })
        return
      }
      if (err instanceof TooLargeError) {
        sendJson(res, 413, { error: 'too large' })
        return
      }
      if (err && (err.code === 'ENOTEMPTY' || err.code === 'EEXIST')) {
        sendJson(res, 409, { error: err.code })
        return
      }
      if (err && (err.code === 'EACCES' || err.code === 'EROFS')) {
        sendJson(res, 500, { error: 'the library directory is not writable' })
        return
      }
      console.error('[deckle] request failed:', req.method, url.pathname, err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      else res.end()
    }
  })()
})

if (LIBRARY_ENABLED) {
  try {
    await library.init()
  } catch (err) {
    console.error(
      `[deckle] server library directory ${LIBRARY_DIR} is not usable (${err.code || err.message}).`,
    )
    console.error('[deckle] mount a writable volume there, or unset DECKLE_SERVER_LIBRARY.')
    process.exit(1)
  }
}

server.listen(PORT, () => {
  // First line, before anything else: whoever is reading these logs is usually
  // reading them because something is wrong, and the first question is always
  // which build this is.
  console.log(`[deckle] Deckle ${VERSION}`)
  console.log(`[deckle] listening on http://0.0.0.0:${PORT}`)
  console.log(`[deckle] serving ${PUBLIC_DIR}`)

  // Say so loudly rather than quietly working: these names will stop being
  // read eventually, and the deployment's .env is the thing to update.
  for (const pair of LEGACY_ENV) {
    console.log(`[deckle] using deprecated config name ${pair} — please rename it in your .env`)
  }

  if (LIBRARY_ENABLED) {
    console.log(`[deckle] server library: ${LIBRARY_DIR} (${LIBRARY_NAME})`)
    console.log(
      auth.required
        ? '[deckle] server library is password protected'
        : '[deckle] WARNING: server library has no password (DECKLE_PASSWORD unset) — anyone who can reach this port can read and write your notes',
    )
    console.log(
      SHARED_SETTINGS
        ? `[deckle] assistant settings shared across devices, stored in ${STATE_DIR}`
        : '[deckle] assistant settings stay in each browser (sharing them needs DECKLE_PASSWORD)',
    )
  } else {
    console.log('[deckle] server library disabled (set DECKLE_SERVER_LIBRARY=true to enable)')
  }

  if (!apiAuth.enabled) {
    console.log('[deckle] API disabled (set DECKLE_API_TOKENS to enable /api/v1)')
  } else if (!LIBRARY_ENABLED) {
    console.log(
      '[deckle] WARNING: API tokens are set but the server library is off — /api/v1 has no library to serve',
    )
  } else {
    console.log(`[deckle] API enabled at /api/v1 — tokens: ${apiAuth.describe().join(', ')}`)
  }
})

// Compose runs this with init:true, so SIGTERM arrives on `docker compose down`.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    // Don't let a hung keep-alive connection block the shutdown.
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
