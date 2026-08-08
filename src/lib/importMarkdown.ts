// Turning what a user drops or picks into notes the library can write.
//
// Three entry shapes, because the browser hands over folder structure in three
// different ways: a `<input webkitdirectory>` puts it on `file.webkitRelativePath`,
// a drag-and-drop only exposes it through the (non-standard but universally
// supported) `webkitGetAsEntry` directory reader, and a ZIP carries its own
// paths inside the archive.

import type { ImportItem } from '../fs/library'
import { isZipName, unzip } from './unzip'

/** Extensions treated as Markdown. `.txt` is included — plain text *is* valid
 *  Markdown, and refusing it would be pedantic. */
const IMPORTABLE = /\.(md|markdown|txt|text)$/i

/** Anything bigger than this isn't a note; refuse rather than freeze the tab. */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** A file that was left out, and why — so the summary can be honest. */
export interface ImportSkip {
  name: string
  reason: string
}

export interface ImportSelection {
  items: ImportItem[]
  skipped: ImportSkip[]
}

/**
 * Progress while a selection is being read. `total` is the number of things
 * picked, not the number of notes — a single ZIP counts as one until it has
 * been expanded, and `label` says which file is being worked on.
 */
export type ReadProgress = (done: number, total: number, label?: string) => void

export function isImportable(name: string): boolean {
  return IMPORTABLE.test(name)
}

/** Everything the pickers should offer, including archives. */
export const IMPORT_ACCEPT =
  '.md,.markdown,.txt,.text,.zip,text/markdown,text/plain,application/zip'

function emptySelection(): ImportSelection {
  return { items: [], skipped: [] }
}

async function toItem(
  file: File,
  path: string,
): Promise<{ item?: ImportItem; skipped?: ImportSkip }> {
  if (!isImportable(file.name)) {
    return { skipped: { name: path, reason: 'not a Markdown file' } }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { skipped: { name: path, reason: 'larger than 8 MB' } }
  }
  try {
    return { item: { path, content: await file.text() } }
  } catch {
    return { skipped: { name: path, reason: 'could not be read' } }
  }
}

// ---- Archives --------------------------------------------------------------

/** "my-notes-2026-08-08.zip" → "my-notes-2026-08-08" */
function archiveBaseName(fileName: string): string {
  return fileName.replace(/\.zip$/i, '') || 'Imported'
}

/**
 * Where the archive's contents should land.
 *
 * If everything inside shares one top-level folder, that folder is the
 * archive's own structure and is kept as-is — the same rule a folder import
 * follows. If the entries sit loose at the root (which is how Deckle's own
 * export is written), they're gathered under a folder named after the ZIP,
 * rather than scattered across the top of the library.
 */
function archivePrefix(paths: string[], fileName: string): string {
  if (!paths.length) return ''
  const first = paths[0]
  const slash = first.indexOf('/')
  if (slash > 0) {
    const root = first.slice(0, slash + 1)
    if (paths.every((p) => p.startsWith(root))) return ''
  }
  return `${archiveBaseName(fileName)}/`
}

/**
 * Expand a ZIP into import items.
 *
 * A malformed archive is reported as one skip rather than thrown: an import of
 * five files where one is a broken ZIP should still bring in the other four.
 */
async function expandArchive(file: File, path: string): Promise<ImportSelection> {
  const out = emptySelection()
  const decoder = new TextDecoder('utf-8')

  let result
  try {
    result = await unzip(await file.arrayBuffer(), {
      maxFileBytes: MAX_FILE_BYTES,
      filter: (entryPath) => {
        if (isImportable(entryPath)) return true
        out.skipped.push({
          name: `${path}/${entryPath}`,
          reason: 'not a Markdown file',
        })
        return false
      },
    })
  } catch (err) {
    out.skipped.push({
      name: path,
      reason: err instanceof Error ? err.message : 'could not be opened',
    })
    return out
  }

  for (const skip of result.skipped) {
    out.skipped.push({ name: `${path}/${skip.path}`, reason: skip.reason })
  }

  const prefix = archivePrefix(
    result.files.map((f) => f.path),
    file.name,
  )
  for (const entry of result.files) {
    out.items.push({
      path: `${prefix}${entry.path}`,
      content: decoder.decode(entry.bytes),
    })
  }

  return out
}

function absorb(out: ImportSelection, part: ImportSelection): void {
  out.items.push(...part.items)
  out.skipped.push(...part.skipped)
}

// ---- File and folder pickers -----------------------------------------------

/** Build import items from a file input (`multiple` and/or `webkitdirectory`). */
export async function selectionFromFiles(
  files: FileList | File[],
  onProgress?: ReadProgress,
): Promise<ImportSelection> {
  const list = Array.from(files)
  const out = emptySelection()

  for (const [index, file] of list.entries()) {
    // webkitRelativePath is set only by a directory picker, and includes the
    // picked folder itself as the first segment — keep it, so importing
    // "Research/" lands the notes in a "Research" folder.
    const path =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name

    onProgress?.(index, list.length, file.name)

    if (isZipName(file.name)) {
      absorb(out, await expandArchive(file, path))
    } else {
      const { item, skipped } = await toItem(file, path)
      if (item) out.items.push(item)
      if (skipped) out.skipped.push(skipped)
    }
  }

  onProgress?.(list.length, list.length)
  return out
}

// ---- Drag and drop ---------------------------------------------------------

interface FileSystemEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (cb: (file: File) => void, err: (e: unknown) => void) => void
  createReader?: () => {
    readEntries: (
      cb: (entries: FileSystemEntryLike[]) => void,
      err: (e: unknown) => void,
    ) => void
  }
}

function entryFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null)
      return
    }
    entry.file(resolve, () => resolve(null))
  })
}

/** readEntries returns at most ~100 entries per call, so it must be drained. */
async function readAllEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.()
  if (!reader) return []
  const all: FileSystemEntryLike[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]))
    })
    if (!batch.length) return all
    all.push(...batch)
  }
}

async function walkEntry(
  entry: FileSystemEntryLike,
  prefix: string,
  out: ImportSelection,
  onProgress?: ReadProgress,
): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    const file = await entryFile(entry)
    if (!file) {
      out.skipped.push({ name: path, reason: 'could not be read' })
      return
    }
    onProgress?.(out.items.length, 0, entry.name)
    if (isZipName(entry.name)) {
      absorb(out, await expandArchive(file, path))
      return
    }
    const { item, skipped } = await toItem(file, path)
    if (item) out.items.push(item)
    if (skipped) out.skipped.push(skipped)
    return
  }

  if (entry.isDirectory && !entry.name.startsWith('.')) {
    for (const child of await readAllEntries(entry)) {
      await walkEntry(child, path, out, onProgress)
    }
  }
}

/**
 * Build import items from a drop, descending into any dropped folders and
 * expanding any dropped archives. Falls back to the flat `dataTransfer.files`
 * list where the entry API is missing.
 */
export async function selectionFromDataTransfer(
  transfer: DataTransfer,
  onProgress?: ReadProgress,
): Promise<ImportSelection> {
  const entries: FileSystemEntryLike[] = []
  for (const item of Array.from(transfer.items ?? [])) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  if (!entries.length) return await selectionFromFiles(transfer.files, onProgress)

  const out = emptySelection()
  for (const entry of entries) await walkEntry(entry, '', out, onProgress)
  return out
}

/** Does this drag carry files (rather than a note being dragged within the app)? */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types ?? []).includes('Files')
}
