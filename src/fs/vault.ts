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
  const target = await uniqueName(parent, desired, name)
  if (target === name) return id

  const content = await (await (await parent.getFileHandle(name)).getFile()).text()
  const writable = await (
    await parent.getFileHandle(target, { create: true })
  ).createWritable()
  await writable.write(content)
  await writable.close()
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
