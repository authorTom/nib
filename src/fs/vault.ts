// Obsidian-style vault backed by the File System Access API.
// Each note is a real `.md` file inside a folder the user picks. Subfolders are
// walked recursively, so notes can be organised in nested folders. A note's
// `id` is its path relative to the vault root (POSIX "/" separators).

export interface NoteFile {
  kind: 'file'
  /** Path relative to the vault root, e.g. "Projects/idea.md". Unique. */
  id: string
  /** File name including extension, e.g. "idea.md". */
  name: string
  /** File name without the .md extension (display title). */
  title: string
  updatedAt: number
}

export interface NoteFolder {
  kind: 'folder'
  /** Path relative to the vault root, e.g. "Projects". */
  id: string
  name: string
  children: TreeNode[]
}

export type TreeNode = NoteFile | NoteFolder

/** A flat note entry (used by app logic that doesn't care about the tree). */
export type NoteMeta = NoteFile

const MD_EXT = /\.md$/i
const ILLEGAL = /[\\/:*?"<>|]/g

export function isVaultSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickVault(): Promise<FileSystemDirectoryHandle> {
  return await (
    window as unknown as {
      showDirectoryPicker: (opts?: {
        id?: string
        mode?: 'read' | 'readwrite'
      }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker({ id: 'notes-vault', mode: 'readwrite' })
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const }
  if ((await handle.queryPermission?.(opts)) === 'granted') return true
  if (!request) return false
  return (await handle.requestPermission?.(opts)) === 'granted'
}

function baseName(fileName: string): string {
  return fileName.replace(MD_EXT, '')
}

function sanitizeName(name: string, fallback: string): string {
  const cleaned = name.replace(ILLEGAL, '').trim()
  return cleaned || fallback
}

function sanitizeTitle(title: string): string {
  return sanitizeName(title, 'Untitled')
}

function splitPath(id: string): { parentPath: string; name: string } {
  const idx = id.lastIndexOf('/')
  if (idx === -1) return { parentPath: '', name: id }
  return { parentPath: id.slice(0, idx), name: id.slice(idx + 1) }
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

async function getDirByPath(
  dir: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  if (!path) return dir
  let cur = dir
  for (const segment of path.split('/')) {
    cur = await cur.getDirectoryHandle(segment, { create })
  }
  return cur
}

function asAsyncEntries(
  dir: FileSystemDirectoryHandle,
): AsyncIterable<FileSystemHandle> {
  // values() is an async iterable not present in older TS DOM libs.
  return (dir as unknown as {
    values: () => AsyncIterable<FileSystemHandle>
  }).values()
}

/** Recursively build the folder/file tree. Hidden entries (dotfiles) are
 *  skipped; empty folders are kept so newly created folders remain visible. */
export async function buildTree(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): Promise<TreeNode[]> {
  const folders: NoteFolder[] = []
  const files: NoteFile[] = []

  for await (const entry of asAsyncEntries(dir)) {
    if (entry.name.startsWith('.')) continue // skip .obsidian, .git, etc.
    const id = joinPath(prefix, entry.name)

    if (entry.kind === 'directory') {
      const children = await buildTree(entry as FileSystemDirectoryHandle, id)
      folders.push({ kind: 'folder', id, name: entry.name, children })
    } else if (MD_EXT.test(entry.name)) {
      const file = await (entry as FileSystemFileHandle).getFile()
      files.push({
        kind: 'file',
        id,
        name: entry.name,
        title: baseName(entry.name),
        updatedAt: file.lastModified,
      })
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.title.localeCompare(b.title))
  return [...folders, ...files]
}

export function flattenFiles(nodes: TreeNode[]): NoteFile[] {
  const out: NoteFile[] = []
  for (const node of nodes) {
    if (node.kind === 'file') out.push(node)
    else out.push(...flattenFiles(node.children))
  }
  return out
}

export async function readNote(
  dir: FileSystemDirectoryHandle,
  id: string,
): Promise<string> {
  const { parentPath, name } = splitPath(id)
  const parent = await getDirByPath(dir, parentPath)
  const handle = await parent.getFileHandle(name)
  return await (await handle.getFile()).text()
}

/** Write content to a note file (creating folders/file if needed). */
export async function writeNote(
  dir: FileSystemDirectoryHandle,
  id: string,
  content: string,
): Promise<number> {
  const { parentPath, name } = splitPath(id)
  const parent = await getDirByPath(dir, parentPath, true)
  const handle = await parent.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
  return (await handle.getFile()).lastModified
}

export async function deleteNote(
  dir: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  const { parentPath, name } = splitPath(id)
  const parent = await getDirByPath(dir, parentPath)
  await parent.removeEntry(name)
}

async function fileExists(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await parent.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** Find a free file name within `parent`, appending " 1", " 2", … on collision. */
async function uniqueName(
  parent: FileSystemDirectoryHandle,
  desired: string,
  exceptName?: string,
): Promise<string> {
  if (desired === exceptName) return desired
  if (!(await fileExists(parent, desired))) return desired
  const base = baseName(desired)
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}.md`
    if (candidate === exceptName || !(await fileExists(parent, candidate))) {
      return candidate
    }
  }
}

/** Create a new note in `folderPath` (root if empty). */
export async function createNote(
  dir: FileSystemDirectoryHandle,
  folderPath = '',
): Promise<NoteFile> {
  const parent = await getDirByPath(dir, folderPath, true)
  const name = await uniqueName(parent, 'Untitled.md')
  const updatedAt = await writeNote(dir, joinPath(folderPath, name), '')
  return {
    kind: 'file',
    id: joinPath(folderPath, name),
    name,
    title: baseName(name),
    updatedAt,
  }
}

/** Write text to `name` within a directory handle (creating it if needed). */
async function writeRaw(
  parent: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const handle = await parent.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * Rename a note's file to match a new title, keeping it in the same folder.
 * Returns the new id. Assumes latest content is already on disk.
 */
export async function renameNote(
  dir: FileSystemDirectoryHandle,
  id: string,
  newTitle: string,
): Promise<string> {
  const { parentPath, name } = splitPath(id)
  const desired = `${sanitizeTitle(newTitle)}.md`
  if (desired === name) return id

  const parent = await getDirByPath(dir, parentPath)
  const src = await parent.getFileHandle(name)
  const content = await (await src.getFile()).text()

  // Does a file with the desired name already exist, and is it a *different*
  // file than the source? (On case-insensitive filesystems, "Note.md"
  // resolves to the same entry as "note.md".)
  let sameEntryDifferentCase = false
  let realConflict = false
  try {
    const existing = await parent.getFileHandle(desired)
    if (await existing.isSameEntry(src)) sameEntryDifferentCase = true
    else realConflict = true
  } catch {
    // `desired` doesn't exist — free to use it.
  }

  if (sameEntryDifferentCase) {
    // Case-only rename on a case-insensitive filesystem. Creating the new name
    // directly just re-opens the same file, so hop through a temporary name to
    // force the directory entry to adopt the new casing.
    const tempName = `.nib-rename-${Date.now()}.md`
    await writeRaw(parent, tempName, content)
    await parent.removeEntry(name)
    await writeRaw(parent, desired, content)
    await parent.removeEntry(tempName)
    return joinPath(parentPath, desired)
  }

  const target = realConflict ? await uniqueName(parent, desired, name) : desired
  if (target === name) return id
  await writeRaw(parent, target, content)
  await parent.removeEntry(name)

  return joinPath(parentPath, target)
}

async function folderExists(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name)
    return true
  } catch {
    return false
  }
}

async function uniqueFolderName(
  parent: FileSystemDirectoryHandle,
  desired: string,
): Promise<string> {
  if (!(await folderExists(parent, desired))) return desired
  for (let i = 1; ; i++) {
    const candidate = `${desired} ${i}`
    if (!(await folderExists(parent, candidate))) return candidate
  }
}

/** Create a subfolder inside `parentPath` (root if empty). Returns its path. */
export async function createFolder(
  dir: FileSystemDirectoryHandle,
  parentPath: string,
  name: string,
): Promise<string> {
  const parent = await getDirByPath(dir, parentPath, true)
  const folderName = await uniqueFolderName(parent, sanitizeName(name, 'New Folder'))
  await parent.getDirectoryHandle(folderName, { create: true })
  return joinPath(parentPath, folderName)
}

/** Recursively copy every entry (files preserved as binary) into `dest`. */
async function copyDirContents(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const entry of asAsyncEntries(src)) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile()
      const handle = await dest.getFileHandle(entry.name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(file) // a File is a Blob → copies binary content
      await writable.close()
    } else {
      const childSrc = entry as FileSystemDirectoryHandle
      const childDest = await dest.getDirectoryHandle(entry.name, { create: true })
      await copyDirContents(childSrc, childDest)
    }
  }
}

/**
 * Rename a folder, keeping it in the same parent. Returns the new path.
 * The File System Access API has no native rename, so this copies the folder's
 * contents into a new directory and removes the old one.
 */
export async function renameFolder(
  dir: FileSystemDirectoryHandle,
  folderPath: string,
  newName: string,
): Promise<string> {
  const { parentPath, name } = splitPath(folderPath)
  const desired = sanitizeName(newName, name)
  if (desired === name) return folderPath

  const parent = await getDirByPath(dir, parentPath)
  const src = await parent.getDirectoryHandle(name)

  // Distinguish a case-only rename (same entry on case-insensitive systems)
  // from a real collision with a different existing folder.
  let sameEntryDifferentCase = false
  let realConflict = false
  try {
    const existing = await parent.getDirectoryHandle(desired)
    if (await existing.isSameEntry(src)) sameEntryDifferentCase = true
    else realConflict = true
  } catch {
    // `desired` doesn't exist — free to use it.
  }

  if (sameEntryDifferentCase) {
    // Case-only rename: hop through a temp folder so the entry adopts the case.
    const tempName = `.nib-rename-${Date.now()}`
    const temp = await parent.getDirectoryHandle(tempName, { create: true })
    await copyDirContents(src, temp)
    await parent.removeEntry(name, { recursive: true })
    const finalDir = await parent.getDirectoryHandle(desired, { create: true })
    await copyDirContents(temp, finalDir)
    await parent.removeEntry(tempName, { recursive: true })
    return joinPath(parentPath, desired)
  }

  const target = realConflict ? await uniqueFolderName(parent, desired) : desired
  const dest = await parent.getDirectoryHandle(target, { create: true })
  await copyDirContents(src, dest)
  await parent.removeEntry(name, { recursive: true })
  return joinPath(parentPath, target)
}

/**
 * Move a note file into `targetFolderPath` (root if empty). Returns the new id.
 * No-op (returns the original id) if already in that folder.
 */
export async function moveNote(
  dir: FileSystemDirectoryHandle,
  id: string,
  targetFolderPath: string,
): Promise<string> {
  const { parentPath, name } = splitPath(id)
  if (parentPath === targetFolderPath) return id

  const srcParent = await getDirByPath(dir, parentPath)
  const destParent = await getDirByPath(dir, targetFolderPath, true)
  const targetName = await uniqueName(destParent, name)

  const content = await (await (await srcParent.getFileHandle(name)).getFile()).text()
  const writable = await (
    await destParent.getFileHandle(targetName, { create: true })
  ).createWritable()
  await writable.write(content)
  await writable.close()
  await srcParent.removeEntry(name)

  return joinPath(targetFolderPath, targetName)
}

// ---- Recycle bin -----------------------------------------------------------
// Deleted notes are moved into a hidden ".trash" folder at the vault root
// (skipped by buildTree). A JSON index records each item's original location
// and deletion time so it can be restored.

export interface TrashItem {
  /** File name within the .trash folder (unique). */
  trashName: string
  /** Path the note was deleted from, e.g. "Projects/idea.md". */
  originalPath: string
  title: string
  deletedAt: number
}

const TRASH_DIR = '.trash'
const TRASH_INDEX = 'index.json'

async function readTrashIndex(
  dir: FileSystemDirectoryHandle,
): Promise<TrashItem[]> {
  try {
    const trash = await dir.getDirectoryHandle(TRASH_DIR)
    const handle = await trash.getFileHandle(TRASH_INDEX)
    const parsed = JSON.parse(await (await handle.getFile()).text())
    return Array.isArray(parsed) ? (parsed as TrashItem[]) : []
  } catch {
    return []
  }
}

async function writeTrashIndex(
  dir: FileSystemDirectoryHandle,
  items: TrashItem[],
): Promise<void> {
  const trash = await dir.getDirectoryHandle(TRASH_DIR, { create: true })
  await writeRaw(trash, TRASH_INDEX, JSON.stringify(items, null, 2))
}

/** Move a note into the recycle bin. */
export async function trashNote(
  dir: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  const { name } = splitPath(id)
  const content = await readNote(dir, id)
  const trash = await dir.getDirectoryHandle(TRASH_DIR, { create: true })
  const trashName = await uniqueName(trash, name)
  await writeRaw(trash, trashName, content)
  await deleteNote(dir, id)

  const items = await readTrashIndex(dir)
  items.push({
    trashName,
    originalPath: id,
    title: baseName(name),
    deletedAt: Date.now(),
  })
  await writeTrashIndex(dir, items)
}

/** List recycle-bin items (newest first), dropping any stale index entries. */
export async function listTrash(
  dir: FileSystemDirectoryHandle,
): Promise<TrashItem[]> {
  let trash: FileSystemDirectoryHandle
  try {
    trash = await dir.getDirectoryHandle(TRASH_DIR)
  } catch {
    return []
  }
  const items = await readTrashIndex(dir)
  const valid: TrashItem[] = []
  for (const item of items) {
    if (await fileExists(trash, item.trashName)) valid.push(item)
  }
  valid.sort((a, b) => b.deletedAt - a.deletedAt)
  return valid
}

/** Restore a recycle-bin item to its original location. Returns the new id. */
export async function restoreTrash(
  dir: FileSystemDirectoryHandle,
  trashName: string,
): Promise<string | null> {
  const items = await readTrashIndex(dir)
  const entry = items.find((i) => i.trashName === trashName)
  if (!entry) return null

  const trash = await dir.getDirectoryHandle(TRASH_DIR)
  const content = await (
    await (await trash.getFileHandle(trashName)).getFile()
  ).text()

  const { parentPath, name } = splitPath(entry.originalPath)
  const parent = await getDirByPath(dir, parentPath, true)
  const target = await uniqueName(parent, name)
  await writeRaw(parent, target, content)
  await trash.removeEntry(trashName)
  await writeTrashIndex(
    dir,
    items.filter((i) => i.trashName !== trashName),
  )
  return joinPath(parentPath, target)
}

/** Permanently delete a single recycle-bin item. */
export async function deleteTrashItem(
  dir: FileSystemDirectoryHandle,
  trashName: string,
): Promise<void> {
  const trash = await dir.getDirectoryHandle(TRASH_DIR, { create: true })
  try {
    await trash.removeEntry(trashName)
  } catch {
    // already gone
  }
  const items = await readTrashIndex(dir)
  await writeTrashIndex(
    dir,
    items.filter((i) => i.trashName !== trashName),
  )
}

/** Permanently delete everything in the recycle bin. */
export async function emptyTrash(
  dir: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    await dir.removeEntry(TRASH_DIR, { recursive: true })
  } catch {
    // nothing to empty
  }
}

/**
 * Delete a folder: move every note inside it (recursively) to the recycle bin,
 * then remove the folder and any remaining (non-note) contents. Returns the
 * number of notes sent to the bin.
 */
export async function trashFolder(
  dir: FileSystemDirectoryHandle,
  folderPath: string,
): Promise<number> {
  const folderHandle = await getDirByPath(dir, folderPath)
  const notes = flattenFiles(await buildTree(folderHandle, folderPath))
  for (const note of notes) {
    await trashNote(dir, note.id)
  }
  const { parentPath, name } = splitPath(folderPath)
  const parent = await getDirByPath(dir, parentPath)
  await parent.removeEntry(name, { recursive: true })
  return notes.length
}

// ---- Helpers used by the AI assistant -------------------------------------

/** Create a folder at an exact path (creating intermediate folders). */
export async function ensureFolder(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  await getDirByPath(dir, path, true)
}

/** Move/rename a note to an exact destination path (permanent, not trashed). */
export async function movePath(
  dir: FileSystemDirectoryHandle,
  from: string,
  to: string,
): Promise<void> {
  const content = await readNote(dir, from)
  await writeNote(dir, to, content)
  await deleteNote(dir, from)
}
