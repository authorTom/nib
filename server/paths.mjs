// Path resolution for the server-side vault.
//
// Every request carries a vault-relative POSIX path ("Projects/idea.md"). The
// only thing standing between that string and the container filesystem is this
// module, so it is deliberately strict: reject anything suspicious up front,
// then verify the resolved path is still inside the vault root.

import path from 'node:path'
import fs from 'node:fs/promises'

/** Thrown for a path that must never reach the filesystem. */
export class BadPathError extends Error {}

const BACKSLASH = 0x5c
const DEL = 0x7f

/**
 * Control characters (NUL included) and backslashes. Both are legal in a Linux
 * file name, but in a path arriving over HTTP they mean something has gone
 * wrong — a truncation attempt, or a Windows path that slipped through.
 */
function hasIllegalChars(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === DEL || code === BACKSLASH) return true
  }
  return false
}

/**
 * Turn a vault-relative path into an absolute one inside `root`.
 *
 * The final containment check catches anything the per-segment rules miss.
 */
export function resolveVaultPath(root, relative) {
  const rel = relative ?? ''
  if (typeof rel !== 'string') throw new BadPathError('path must be a string')
  if (hasIllegalChars(rel)) throw new BadPathError('illegal character in path')
  if (rel.startsWith('/')) throw new BadPathError('path must be relative')

  const segments = rel.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.some((s) => s === '..')) {
    throw new BadPathError('path may not traverse upwards')
  }

  const abs = path.resolve(root, ...segments)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new BadPathError('path escapes the vault root')
  }
  return abs
}

/**
 * Containment check that also follows symlinks.
 *
 * `resolveVaultPath` works on the path string alone, so a symlink *inside* the
 * vault pointing at /etc would still resolve "inside" the root. Anything that
 * reads or writes file content runs this too. Missing files are fine (a write
 * creates them) — we validate the nearest existing ancestor instead.
 */
export async function assertRealPathInside(root, abs) {
  const realRoot = await fs.realpath(root)
  let probe = abs
  for (;;) {
    try {
      const real = await fs.realpath(probe)
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new BadPathError('path escapes the vault root')
      }
      return
    } catch (err) {
      if (err instanceof BadPathError) throw err
      if (err.code !== 'ENOENT') throw err
      const parent = path.dirname(probe)
      // Reached the filesystem root without finding an existing ancestor.
      if (parent === probe) throw new BadPathError('path escapes the vault root')
      probe = parent
    }
  }
}

/** A single path segment (a file or folder name) may not contain separators. */
export function assertValidName(name) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') {
    throw new BadPathError('invalid name')
  }
  if (name.includes('/') || hasIllegalChars(name)) {
    throw new BadPathError('invalid name')
  }
}

/** Join a vault-relative prefix and a name into a vault-relative path. */
export function joinRelative(prefix, name) {
  return prefix ? `${prefix}/${name}` : name
}
