// Static serving for the built SPA.
//
// This replaces the nginx config the image used to ship, with the same policy:
// content-hashed files under /assets are cached forever, everything else is
// revalidated so a new deployment takes effect on the next load, unknown paths
// fall back to index.html for client-side routing, and the security header
// trio is set on every response.

import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { createReadStream } from 'node:fs'
import { promisify } from 'node:util'

const gzip = promisify(zlib.gzip)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const COMPRESSIBLE = /^(text\/|application\/(javascript|json)|image\/svg)/
const GZIP_MIN_BYTES = 1024

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

export function createStaticHandler(publicDir) {
  // Compressed copies of small text assets, keyed by path + mtime. The asset
  // set is fixed at image build time, so this fills once and stays warm.
  const gzipCache = new Map()

  async function resolveFile(urlPath) {
    // Reject traversal before touching the filesystem. path.normalize on the
    // decoded URL collapses any "..", and the result must stay under publicDir.
    let decoded
    try {
      decoded = decodeURIComponent(urlPath)
    } catch {
      return null
    }
    if (decoded.includes('\0')) return null

    const abs = path.join(publicDir, path.normalize(decoded))
    if (abs !== publicDir && !abs.startsWith(publicDir + path.sep)) return null

    try {
      const stat = await fs.stat(abs)
      if (stat.isFile()) return { abs, stat }
      if (stat.isDirectory()) {
        const index = path.join(abs, 'index.html')
        const indexStat = await fs.stat(index)
        if (indexStat.isFile()) return { abs: index, stat: indexStat }
      }
    } catch {
      // Falls through to the SPA fallback.
    }
    return null
  }

  return async function serveStatic(req, res, urlPath) {
    let file = await resolveFile(urlPath)
    let isFallback = false

    if (!file) {
      // A missing file under /assets is a genuine 404 — serving index.html for
      // a stale hashed asset would hand the browser HTML where it expects JS.
      if (urlPath.startsWith('/assets/')) {
        res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
      file = await resolveFile('/index.html')
      isFallback = true
      if (!file) {
        res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
    }

    const ext = path.extname(file.abs).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    const immutable = !isFallback && urlPath.startsWith('/assets/')

    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': file.stat.size })
      res.end()
      return
    }

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    if (acceptsGzip && COMPRESSIBLE.test(type) && file.stat.size >= GZIP_MIN_BYTES) {
      const key = `${file.abs}:${file.stat.mtimeMs}`
      let body = gzipCache.get(key)
      if (!body) {
        body = await gzip(await fs.readFile(file.abs))
        gzipCache.set(key, body)
      }
      res.writeHead(200, {
        ...headers,
        'Content-Encoding': 'gzip',
        'Content-Length': body.length,
        Vary: 'Accept-Encoding',
      })
      res.end(body)
      return
    }

    res.writeHead(200, { ...headers, 'Content-Length': file.stat.size })
    createReadStream(file.abs).pipe(res)
  }
}
