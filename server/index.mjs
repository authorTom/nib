// Nib server: serves the built SPA and, optionally, a server-side vault.
//
// Nib is still a local-first app — by default it stores notes in a folder you
// pick or privately in the browser, and this process is then nothing more than
// a static file server. Mount a volume and the same process also offers a
// *server vault*: real .md files living in the container, so the app works from
// any device with no local storage at all.
//
// The server vault is opt-in: without NIB_SERVER_VAULT=true this process is a
// pure static file server and the image behaves exactly as it always has. That
// default matters — enabling it implicitly would offer people a vault that
// silently disappears with the container unless they also mounted a volume.
//
// Configuration (all optional):
//   PORT                 port to listen on                    (default 8080)
//   NIB_SERVER_VAULT     "true" enables the server vault      (default off)
//   NIB_VAULT_DIR        directory holding the server vault   (default /data)
//   NIB_VAULT_NAME       display name shown in the app        (default "My Notes")
//   NIB_PASSWORD         password gating the server vault; unset = open access
//   NIB_SESSION_SECRET   keeps sessions valid across restarts
//   NIB_SESSION_TTL_DAYS session lifetime                     (default 30)
//   NIB_API_TOKENS       bearer tokens enabling the /api/v1 machine API
//   NIB_API_CORS_ORIGINS origins allowed to call /api/v1 from a browser

import http from 'node:http'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth.mjs'
import { createApiAuth } from './api-auth.mjs'
import { createApi } from './api.mjs'
import { createSearch } from './search.mjs'
import { createStaticHandler, SECURITY_HEADERS } from './static.mjs'
import { createVaultApi, TooLargeError } from './vault-api.mjs'
import { createVaultStore } from './vault-store.mjs'
import { BadPathError } from './paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT || 8080)
const PUBLIC_DIR = path.resolve(process.env.NIB_PUBLIC_DIR || path.join(here, '..', 'dist'))
const VAULT_DIR = path.resolve(process.env.NIB_VAULT_DIR || '/data')
const VAULT_NAME = process.env.NIB_VAULT_NAME || 'My Notes'
const VAULT_ENABLED = process.env.NIB_SERVER_VAULT === 'true'

const auth = createAuth(process.env)
const vault = createVaultApi(VAULT_DIR)
const serveStatic = createStaticHandler(PUBLIC_DIR)

// The machine API (/api/v1): off unless tokens are configured, and useless
// without the server vault, since a local-folder vault never reaches this
// process at all.
const apiAuth = createApiAuth(process.env)
const handleApi = createApi({
  vault,
  store: createVaultStore(vault),
  search: createSearch(vault),
  auth: apiAuth,
  vaultEnabled: VAULT_ENABLED,
  vaultName: VAULT_NAME,
  corsOrigins: (process.env.NIB_API_CORS_ORIGINS || '')
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
  return req.headers['x-nib-app'] === '1'
}

// ---- /api/server-vault -----------------------------------------------------

async function handleServerVaultRoutes(req, res, url) {
  if (url.pathname === '/api/server-vault' && req.method === 'GET') {
    sendJson(res, 200, {
      enabled: VAULT_ENABLED,
      name: VAULT_NAME,
      authRequired: auth.required,
      authenticated: VAULT_ENABLED && auth.isAuthenticated(req),
    })
    return true
  }

  if (url.pathname === '/api/server-vault/login' && req.method === 'POST') {
    if (!VAULT_ENABLED) {
      sendJson(res, 404, { error: 'server vault disabled' })
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

  if (url.pathname === '/api/server-vault/logout' && req.method === 'POST') {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.logoutCookie(req) })
    return true
  }

  return false
}

// ---- /api/vault ------------------------------------------------------------

async function handleVaultRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/vault/')) return false

  if (!VAULT_ENABLED) {
    sendJson(res, 404, { error: 'server vault disabled' })
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
    case 'GET /api/vault/tree':
      sendJson(res, 200, { tree: await vault.tree(rel) })
      return true

    case 'GET /api/vault/list':
      sendJson(res, 200, { entries: await vault.list(rel) })
      return true

    case 'GET /api/vault/stat':
      sendJson(res, 200, await vault.stat(rel))
      return true

    case 'GET /api/vault/file': {
      const { abs, size, lastModified } = await vault.fileForRead(rel)
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

    case 'PUT /api/vault/file': {
      const declared = Number(req.headers['content-length'] || 0)
      if (declared > vault.maxFileBytes) {
        sendJson(res, 413, { error: 'file too large' })
        return true
      }
      sendJson(res, 200, await vault.writeFile(rel, req))
      return true
    }

    case 'POST /api/vault/dir':
      await vault.mkdir(rel)
      sendJson(res, 200, { ok: true })
      return true

    case 'DELETE /api/vault/entry':
      await vault.remove(rel, url.searchParams.get('recursive') === '1')
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
      if (await handleServerVaultRoutes(req, res, url)) return
      if (await handleVaultRoutes(req, res, url)) return

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
        sendJson(res, 500, { error: 'the vault directory is not writable' })
        return
      }
      console.error('[nib] request failed:', req.method, url.pathname, err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      else res.end()
    }
  })()
})

if (VAULT_ENABLED) {
  try {
    await vault.init()
  } catch (err) {
    console.error(
      `[nib] server vault directory ${VAULT_DIR} is not usable (${err.code || err.message}).`,
    )
    console.error('[nib] mount a writable volume there, or unset NIB_SERVER_VAULT.')
    process.exit(1)
  }
}

server.listen(PORT, () => {
  console.log(`[nib] listening on http://0.0.0.0:${PORT}`)
  console.log(`[nib] serving ${PUBLIC_DIR}`)
  if (VAULT_ENABLED) {
    console.log(`[nib] server vault: ${VAULT_DIR} (${VAULT_NAME})`)
    console.log(
      auth.required
        ? '[nib] server vault is password protected'
        : '[nib] WARNING: server vault has no password (NIB_PASSWORD unset) — anyone who can reach this port can read and write your notes',
    )
  } else {
    console.log('[nib] server vault disabled (set NIB_SERVER_VAULT=true to enable)')
  }

  if (!apiAuth.enabled) {
    console.log('[nib] API disabled (set NIB_API_TOKENS to enable /api/v1)')
  } else if (!VAULT_ENABLED) {
    console.log(
      '[nib] WARNING: API tokens are set but the server vault is off — /api/v1 has no vault to serve',
    )
  } else {
    console.log(`[nib] API enabled at /api/v1 — tokens: ${apiAuth.describe().join(', ')}`)
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
