// The server-side library: a thin, deliberately dumb file API over a directory
// in the container (a Docker volume, by default /data).
//
// It mirrors the handful of operations the browser's File System Access API
// offers, because the client adapter (src/fs/remote.ts) presents these
// endpoints *as* a FileSystemDirectoryHandle. Keeping the two in step is what
// lets the rest of the app stay backend-agnostic — notes, history, tasks,
// bookmarks and the AI tools all go through the same handle interface.
//
// Endpoints (all library-relative paths in the ?path= query parameter):
//   GET    /api/library/tree    recursive note tree (one round trip per refresh)
//   GET    /api/library/list    shallow directory listing, including dotfiles
//   GET    /api/library/stat    entry kind + mtime, 404 when missing
//   GET    /api/library/file    file contents
//   PUT    /api/library/file    write file contents (creates parent folders)
//   POST   /api/library/dir     create a directory (mkdir -p)
//   DELETE /api/library/entry   remove a file or directory

import fs from 'node:fs/promises'
import path from 'node:path'
import { constants as fsConstants, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import {
  BadPathError,
  assertRealPathInside,
  joinRelative,
  resolveLibraryPath,
} from './paths.mjs'

const MD_EXT = /\.md$/i

/**
 * A folder inside the library root that this API pretends does not exist.
 *
 * The server keeps its own state there (the shared assistant settings, and the
 * API key in them), and it sits under the library directory only because that
 * is the volume a self-hoster actually mounts — not because it is part of the
 * library. Every way out of this module passes through `safePath` or `list`,
 * so denying it in those two places is what keeps it out of: the file API, the
 * client's export walk (which lists its way through the remote handle), the
 * server's own export walk, the machine API, and the assistant's read_note
 * tool — none of which have any business reading a key.
 *
 * Set DECKLE_STATE_DIR to move the state somewhere else entirely; this name
 * stays reserved either way, so a library can't grow a folder that would
 * later collide with it.
 */
export const RESERVED_DIR = '.deckle-state'

/** Notes are text; this cap stops a single request filling the volume. */
const MAX_FILE_BYTES = 32 * 1024 * 1024

/** Thrown when an upload exceeds MAX_FILE_BYTES mid-stream. */
export class TooLargeError extends Error {}

/** Abort a stream once it has passed `limit` bytes (Content-Length can lie). */
function limitBytes(limit) {
  let seen = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length
      if (seen > limit) {
        callback(new TooLargeError('file too large'))
        return
      }
      callback(null, chunk)
    },
  })
}

export function createLibraryApi(root) {
  /** Resolve + symlink-check in one step, refusing the reserved folder. */
  async function safePath(rel) {
    const first = String(rel ?? '').replace(/\\/g, '/').split('/')[0]
    if (first === RESERVED_DIR) {
      throw new BadPathError(`${RESERVED_DIR} is reserved`)
    }
    const abs = resolveLibraryPath(root, rel)
    await assertRealPathInside(root, abs)
    return abs
  }

  /**
   * Recursive walk producing exactly the shape `buildTree` in src/fs/library.ts
   * builds by hand: folders first, then files, both sorted by display name,
   * with dotfiles skipped and non-.md files ignored. Ids are relative to the
   * directory being walked; the client re-prefixes them if it asked for a
   * subfolder.
   */
  async function walk(abs, prefix) {
    const folders = []
    const files = []

    let entries
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch (err) {
      if (err.code === 'ENOENT') return []
      throw err
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue // .trash, .history, .deckle, .git…
      const id = joinRelative(prefix, entry.name)

      if (entry.isDirectory()) {
        folders.push({
          kind: 'folder',
          id,
          name: entry.name,
          children: await walk(path.join(abs, entry.name), id),
        })
      } else if (entry.isFile() && MD_EXT.test(entry.name)) {
        const stat = await fs.stat(path.join(abs, entry.name))
        files.push({
          kind: 'file',
          id,
          name: entry.name,
          title: entry.name.replace(MD_EXT, ''),
          updatedAt: Math.round(stat.mtimeMs),
        })
      }
      // Symlinks and other entry kinds are ignored rather than followed.
    }

    folders.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.title.localeCompare(b.title))
    return [...folders, ...files]
  }

  return {
    /** Create the library directory if this is a first run. */
    async init() {
      await fs.mkdir(root, { recursive: true })
      // Fail fast and loudly if the volume is mounted read-only, rather than
      // letting every later write fail one at a time in the UI.
      await fs.access(root, fsConstants.W_OK)
    },

    async tree(rel) {
      const abs = await safePath(rel)
      return await walk(abs, '')
    },

    async list(rel) {
      const abs = await safePath(rel)
      const entries = await fs.readdir(abs, { withFileTypes: true })
      const out = []
      for (const entry of entries) {
        // Reserved at the root only: a note folder deeper in the tree may
        // legitimately carry any name.
        if (!rel && entry.name === RESERVED_DIR) continue
        if (entry.isDirectory()) {
          out.push({ name: entry.name, kind: 'directory' })
        } else if (entry.isFile()) {
          const stat = await fs.stat(path.join(abs, entry.name))
          out.push({
            name: entry.name,
            kind: 'file',
            lastModified: Math.round(stat.mtimeMs),
            size: stat.size,
          })
        }
      }
      return out
    },

    async stat(rel) {
      const abs = await safePath(rel)
      const stat = await fs.stat(abs)
      if (stat.isDirectory()) return { kind: 'directory' }
      return {
        kind: 'file',
        lastModified: Math.round(stat.mtimeMs),
        size: stat.size,
      }
    },

    /** Absolute path for streaming a file back, after all safety checks. */
    async fileForRead(rel) {
      const abs = await safePath(rel)
      const stat = await fs.stat(abs)
      if (!stat.isFile()) {
        const err = new Error('not a file')
        err.code = 'ENOTFILE'
        throw err
      }
      return { abs, size: stat.size, lastModified: Math.round(stat.mtimeMs) }
    },

    /**
     * Stream a request body into a file, creating parent folders. Written to a
     * temporary name in the same directory and renamed into place, so an
     * interrupted upload can't truncate a note that already exists.
     */
    async writeFile(rel, stream) {
      const abs = await safePath(rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      const tmp = path.join(
        path.dirname(abs),
        `.deckle-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      try {
        await pipeline(stream, limitBytes(MAX_FILE_BYTES), createWriteStream(tmp))
        await fs.rename(tmp, abs)
      } catch (err) {
        await fs.rm(tmp, { force: true })
        throw err
      }
      const stat = await fs.stat(abs)
      return { lastModified: Math.round(stat.mtimeMs), size: stat.size }
    },

    /** Read a file as UTF-8. Used by the JSON stores and the search index. */
    async readText(rel) {
      const abs = await safePath(rel)
      return await fs.readFile(abs, 'utf8')
    },

    /** Read a file's raw bytes — the export archive carries attachments too,
     *  not just Markdown, so it can't go through readText. */
    async readBuffer(rel) {
      const abs = await safePath(rel)
      return await fs.readFile(abs)
    },

    /** Write UTF-8 text, creating parent folders. Same atomic rename as
     *  `writeFile`, so an interrupted write can't truncate an existing note. */
    async writeText(rel, text) {
      const abs = await safePath(rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      const tmp = path.join(
        path.dirname(abs),
        `.deckle-write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      try {
        await fs.writeFile(tmp, text, 'utf8')
        await fs.rename(tmp, abs)
      } catch (err) {
        await fs.rm(tmp, { force: true })
        throw err
      }
      const stat = await fs.stat(abs)
      return { lastModified: Math.round(stat.mtimeMs), size: stat.size }
    },

    /** Does an entry exist? Returns 'file', 'directory', or null. */
    async exists(rel) {
      try {
        const abs = await safePath(rel)
        const stat = await fs.stat(abs)
        return stat.isDirectory() ? 'directory' : 'file'
      } catch {
        return null
      }
    },

    async mkdir(rel) {
      const abs = await safePath(rel)
      await fs.mkdir(abs, { recursive: true })
    },

    async remove(rel, recursive) {
      const abs = await safePath(rel)
      if (abs === root) throw new BadPathError('cannot remove the library root')
      const stat = await fs.stat(abs)
      if (stat.isDirectory()) {
        if (recursive) {
          await fs.rm(abs, { recursive: true, force: true })
        } else {
          // Matches removeEntry() without { recursive: true }: refuses to
          // delete a non-empty directory.
          await fs.rmdir(abs)
        }
      } else {
        await fs.unlink(abs)
      }
    },

    maxFileBytes: MAX_FILE_BYTES,
  }
}
