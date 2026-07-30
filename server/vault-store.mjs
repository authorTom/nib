// The vault's *semantics*, server-side.
//
// server/vault-api.mjs is a dumb file API — read this path, write that one.
// Everything above it (unique names, the recycle bin, version history, the
// tasks and bookmarks JSON) lives in the browser, in src/fs/vault.ts,
// src/fs/history.ts and the two stores, because until now the browser was the
// only thing that ever touched a vault.
//
// The API changed that: an agent writing a note must trash it into the same
// `.trash`, snapshot into the same `.history`, and add tasks to the same
// `.nib/tasks.json` the app reads, or the two halves would quietly disagree.
// So this module mirrors those rules. The formats are the contract — if one
// side changes, the other must follow.

const MD_EXT = /\.md$/i
const ILLEGAL = /[\\/:*?"<>|]/g

const TRASH_DIR = '.trash'
const TRASH_INDEX = `${TRASH_DIR}/index.json`
const HISTORY_DIR = '.history'
const HISTORY_INDEX = `${HISTORY_DIR}/index.json`
const NIB_DIR = '.nib'
const TASKS_FILE = `${NIB_DIR}/tasks.json`
const BOOKMARKS_FILE = `${NIB_DIR}/bookmarks.json`

/** Snapshots kept per note, matching src/fs/history.ts. */
const MAX_HISTORY_PER_NOTE = 20

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function baseName(fileName) {
  return fileName.replace(MD_EXT, '')
}

function splitPath(id) {
  const idx = id.lastIndexOf('/')
  if (idx === -1) return { parentPath: '', name: id }
  return { parentPath: id.slice(0, idx), name: id.slice(idx + 1) }
}

function joinPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name
}

function sanitizeName(name, fallback) {
  const cleaned = String(name ?? '').replace(ILLEGAL, '').trim()
  return cleaned || fallback
}

/**
 * Control characters have no business in a path arriving over HTTP, and a NUL
 * in particular is a truncation attempt. paths.mjs rejects them too, but by
 * then the byte has already been copied into an error message — catch it here
 * so nothing echoes it back.
 */
function assertPrintable(raw) {
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ApiError(400, 'invalid_path', 'path contains a control character')
  }
}

/**
 * Normalise a note path from a request: strip leading slashes, reject dotfolder
 * segments (the app's tree skips them, so a note written there would be
 * invisible), and force a `.md` extension.
 */
export function normalizeNotePath(raw) {
  const value = String(raw ?? '')
  assertPrintable(value)
  const segments = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')

  if (!segments.length) throw new ApiError(400, 'invalid_path', 'path is required')
  if (segments.some((s) => s === '..')) {
    throw new ApiError(400, 'invalid_path', 'path may not traverse upwards')
  }
  if (segments.some((s) => s.startsWith('.'))) {
    throw new ApiError(
      400,
      'invalid_path',
      'path may not contain hidden (dot) folders — those are reserved for Nib',
    )
  }

  const leaf = segments.pop()
  const name = MD_EXT.test(leaf) ? leaf : `${leaf}.md`
  return joinPath(segments.join('/'), name)
}

/** Same rules, but for a folder path (no extension forced, '' means the root). */
export function normalizeFolderPath(raw) {
  const value = String(raw ?? '')
  assertPrintable(value)
  const segments = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
  if (segments.some((s) => s === '..')) {
    throw new ApiError(400, 'invalid_path', 'path may not traverse upwards')
  }
  if (segments.some((s) => s.startsWith('.'))) {
    throw new ApiError(400, 'invalid_path', 'path may not contain hidden (dot) folders')
  }
  return segments.join('/')
}

/**
 * Serialise read-modify-write on the shared JSON files. Two concurrent API
 * calls adding a task would otherwise each read the same array and the second
 * write would drop the first task.
 */
function createLocks() {
  const chains = new Map()
  return function withLock(key, fn) {
    const previous = chains.get(key) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    // Keep the chain alive but never let a rejection poison the next waiter.
    chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}

export function createVaultStore(vault) {
  const withLock = createLocks()

  async function readJson(path, fallback) {
    try {
      const parsed = JSON.parse(await vault.readText(path))
      return parsed ?? fallback
    } catch {
      return fallback
    }
  }

  async function writeJson(path, value) {
    await vault.writeText(path, JSON.stringify(value, null, 2))
  }

  // ---- Notes ---------------------------------------------------------------

  /** Find a free file name in `folder`, appending " 1", " 2", … on collision. */
  async function uniqueName(folder, desired) {
    if (!(await vault.exists(joinPath(folder, desired)))) return desired
    const base = baseName(desired)
    for (let i = 1; ; i++) {
      const candidate = `${base} ${i}.md`
      if (!(await vault.exists(joinPath(folder, candidate)))) return candidate
    }
  }

  async function readNote(path) {
    const kind = await vault.exists(path)
    if (kind !== 'file') throw new ApiError(404, 'not_found', `no note at "${path}"`)
    const [content, stat] = await Promise.all([vault.readText(path), vault.stat(path)])
    return {
      path,
      title: baseName(splitPath(path).name),
      folder: splitPath(path).parentPath,
      content,
      updatedAt: stat.lastModified,
      size: stat.size,
    }
  }

  /**
   * Create a note without ever overwriting one: a collision gets a numbered
   * suffix, the same rule the app's "New note" button follows.
   */
  async function createNote({ path, content = '' }) {
    const { parentPath, name } = splitPath(path)
    const finalName = await uniqueName(parentPath, name)
    const finalPath = joinPath(parentPath, finalName)
    await vault.writeText(finalPath, content)
    return await readNote(finalPath)
  }

  /**
   * Create or replace a note. An overwrite snapshots the version it replaces
   * into `.history` first, so an agent's edits are as recoverable as the app's.
   */
  async function writeNote(path, content, reason = 'ai') {
    const existing = await vault.exists(path)
    if (existing === 'directory') {
      throw new ApiError(409, 'conflict', `"${path}" is a folder`)
    }
    if (existing === 'file') {
      const previous = await vault.readText(path)
      if (previous.trim() && previous !== content) {
        await snapshot(path, previous, reason)
      }
    }
    await vault.writeText(path, content)
    return { note: await readNote(path), created: existing !== 'file' }
  }

  /** Move or rename a note, carrying its history entries with it. */
  async function moveNote(from, to) {
    if (from === to) return await readNote(from)
    if (await vault.exists(to)) {
      throw new ApiError(409, 'conflict', `a note already exists at "${to}"`)
    }
    const content = await vault.readText(from)
    await vault.writeText(to, content)
    await vault.remove(from, false)
    await retargetHistory(from, to)
    return await readNote(to)
  }

  // ---- Recycle bin ---------------------------------------------------------

  async function listTrash() {
    const items = await readJson(TRASH_INDEX, [])
    const valid = []
    for (const item of Array.isArray(items) ? items : []) {
      if (await vault.exists(joinPath(TRASH_DIR, item.trashName))) valid.push(item)
    }
    valid.sort((a, b) => b.deletedAt - a.deletedAt)
    return valid
  }

  /** Move a note to the recycle bin, recording where it came from. */
  async function trashNote(path) {
    const content = await vault.readText(path)
    return await withLock(TRASH_INDEX, async () => {
      const { name } = splitPath(path)
      const trashName = await uniqueName(TRASH_DIR, name)
      await vault.writeText(joinPath(TRASH_DIR, trashName), content)
      await vault.remove(path, false)

      const items = await readJson(TRASH_INDEX, [])
      const entry = {
        trashName,
        originalPath: path,
        title: baseName(name),
        deletedAt: Date.now(),
      }
      await writeJson(TRASH_INDEX, [...(Array.isArray(items) ? items : []), entry])
      return entry
    })
  }

  async function restoreTrash(trashName) {
    return await withLock(TRASH_INDEX, async () => {
      const items = await readJson(TRASH_INDEX, [])
      const entry = (Array.isArray(items) ? items : []).find(
        (i) => i.trashName === trashName,
      )
      if (!entry) throw new ApiError(404, 'not_found', 'no such item in the recycle bin')

      const content = await vault.readText(joinPath(TRASH_DIR, trashName))
      const { parentPath, name } = splitPath(entry.originalPath)
      const target = await uniqueName(parentPath, name)
      const path = joinPath(parentPath, target)

      await vault.writeText(path, content)
      await vault.remove(joinPath(TRASH_DIR, trashName), false)
      await writeJson(
        TRASH_INDEX,
        items.filter((i) => i.trashName !== trashName),
      )
      return await readNote(path)
    })
  }

  async function deleteTrashItem(trashName) {
    return await withLock(TRASH_INDEX, async () => {
      const items = await readJson(TRASH_INDEX, [])
      const list = Array.isArray(items) ? items : []
      if (!list.some((i) => i.trashName === trashName)) {
        throw new ApiError(404, 'not_found', 'no such item in the recycle bin')
      }
      try {
        await vault.remove(joinPath(TRASH_DIR, trashName), false)
      } catch {
        // Already gone from disk; still drop the index entry.
      }
      await writeJson(
        TRASH_INDEX,
        list.filter((i) => i.trashName !== trashName),
      )
    })
  }

  // ---- Version history -----------------------------------------------------

  /** Save `content` as the previous version of `notePath`, pruning old ones. */
  async function snapshot(notePath, content, reason) {
    await withLock(HISTORY_INDEX, async () => {
      const savedAt = Date.now()
      const snapName = `${savedAt}_${notePath.replace(/\//g, '__')}`
      await vault.writeText(joinPath(HISTORY_DIR, snapName), content)

      const items = await readJson(HISTORY_INDEX, [])
      const list = Array.isArray(items) ? items : []
      list.push({ snapName, noteId: notePath, savedAt, reason })

      const mine = list
        .filter((i) => i.noteId === notePath)
        .sort((a, b) => b.savedAt - a.savedAt)
      for (const stale of mine.slice(MAX_HISTORY_PER_NOTE)) {
        try {
          await vault.remove(joinPath(HISTORY_DIR, stale.snapName), false)
        } catch {
          // already gone
        }
      }
      const keep = new Set(mine.slice(0, MAX_HISTORY_PER_NOTE).map((i) => i.snapName))
      await writeJson(
        HISTORY_INDEX,
        list.filter((i) => i.noteId !== notePath || keep.has(i.snapName)),
      )
    }).catch(() => {
      // History must never break the write it protects.
    })
  }

  async function listHistory(notePath) {
    const items = await readJson(HISTORY_INDEX, [])
    const list = (Array.isArray(items) ? items : []).filter(
      (i) => !notePath || i.noteId === notePath,
    )
    const valid = []
    for (const item of list) {
      if (await vault.exists(joinPath(HISTORY_DIR, item.snapName))) valid.push(item)
    }
    valid.sort((a, b) => b.savedAt - a.savedAt)
    return valid
  }

  async function readSnapshot(snapName) {
    if (snapName.includes('/')) throw new ApiError(400, 'invalid_path', 'invalid snapshot')
    const path = joinPath(HISTORY_DIR, snapName)
    if ((await vault.exists(path)) !== 'file') {
      throw new ApiError(404, 'not_found', 'no such snapshot')
    }
    return await vault.readText(path)
  }

  async function retargetHistory(fromPath, toPath) {
    await withLock(HISTORY_INDEX, async () => {
      const items = await readJson(HISTORY_INDEX, [])
      const list = Array.isArray(items) ? items : []
      let changed = false
      for (const item of list) {
        if (item.noteId === fromPath) {
          item.noteId = toPath
          changed = true
        }
      }
      if (changed) await writeJson(HISTORY_INDEX, list)
    }).catch(() => {
      // best effort
    })
  }

  // ---- Tasks & bookmarks ---------------------------------------------------

  const EMPTY_TASKS = { version: 1, tasks: [], projects: [] }
  const EMPTY_BOOKMARKS = { version: 1, bookmarks: [], collections: [] }

  async function loadTasks() {
    const store = await readJson(TASKS_FILE, EMPTY_TASKS)
    return store?.version === 1 && Array.isArray(store.tasks) && Array.isArray(store.projects)
      ? store
      : EMPTY_TASKS
  }

  async function loadBookmarks() {
    const store = await readJson(BOOKMARKS_FILE, EMPTY_BOOKMARKS)
    return store?.version === 1 &&
      Array.isArray(store.bookmarks) &&
      Array.isArray(store.collections)
      ? store
      : EMPTY_BOOKMARKS
  }

  /** Read-modify-write the task store under a lock. */
  function updateTasks(mutate) {
    return withLock(TASKS_FILE, async () => {
      const store = await loadTasks()
      const result = await mutate(store)
      await writeJson(TASKS_FILE, store)
      return result
    })
  }

  function updateBookmarks(mutate) {
    return withLock(BOOKMARKS_FILE, async () => {
      const store = await loadBookmarks()
      const result = await mutate(store)
      await writeJson(BOOKMARKS_FILE, store)
      return result
    })
  }

  return {
    // paths
    joinPath,
    splitPath,
    baseName,
    sanitizeName,
    // notes
    readNote,
    createNote,
    writeNote,
    moveNote,
    uniqueName,
    // bin
    listTrash,
    trashNote,
    restoreTrash,
    deleteTrashItem,
    // history
    snapshot,
    listHistory,
    readSnapshot,
    // tasks & bookmarks
    loadTasks,
    updateTasks,
    loadBookmarks,
    updateBookmarks,
    // constants the API needs for export filtering
    HIDDEN_DIRS: [TRASH_DIR, HISTORY_DIR],
    NIB_DIR,
  }
}
