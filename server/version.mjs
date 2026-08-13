// Which Deckle this is.
//
// package.json is the single source of the version — the browser bundle gets it
// baked in by Vite, and this reads the same field at boot so the two can never
// disagree. Read once, synchronously, before anything is served: it is four
// lines of I/O at startup, and every caller after that wants a plain string.
//
// The runtime image copies package.json next to server/ for exactly this (see
// the Dockerfile); if it is ever missing, the server still starts and reports
// "unknown" rather than refusing to serve a library over a cosmetic detail.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function read() {
  try {
    const raw = readFileSync(path.join(here, '..', 'package.json'), 'utf8')
    return JSON.parse(raw).version || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** e.g. "1.0.0", or "unknown" if package.json didn't make it into the image. */
export const VERSION = read()
