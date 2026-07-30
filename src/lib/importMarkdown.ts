// Turning what a user drops or picks into notes the vault can write.
//
// Two entry points, because the browser gives folder structure in two different
// shapes: a `<input webkitdirectory>` puts it on `file.webkitRelativePath`,
// while a drag-and-drop only exposes it through the (non-standard but
// universally supported) `webkitGetAsEntry` directory reader.

import type { ImportItem } from '../fs/vault'

/** Extensions treated as Markdown. `.txt` is included — plain text *is* valid
 *  Markdown, and refusing it would be pedantic. */
const IMPORTABLE = /\.(md|markdown|txt|text)$/i

/** Anything bigger than this isn't a note; refuse rather than freeze the tab. */
const MAX_FILE_BYTES = 8 * 1024 * 1024

export interface ImportSelection {
  items: ImportItem[]
  /** Files that were ignored, with the reason, for an honest summary toast. */
  skipped: { name: string; reason: string }[]
}

export function isImportable(name: string): boolean {
  return IMPORTABLE.test(name)
}

async function toItem(
  file: File,
  path: string,
): Promise<{ item?: ImportItem; skipped?: { name: string; reason: string } }> {
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

/** Build import items from a file input (`multiple` and/or `webkitdirectory`). */
export async function selectionFromFiles(files: FileList | File[]): Promise<ImportSelection> {
  const items: ImportItem[] = []
  const skipped: ImportSelection['skipped'] = []

  for (const file of Array.from(files)) {
    // webkitRelativePath is set only by a directory picker, and includes the
    // picked folder itself as the first segment — keep it, so importing
    // "Research/" lands the notes in a "Research" folder.
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const { item, skipped: miss } = await toItem(file, path)
    if (item) items.push(item)
    if (miss) skipped.push(miss)
  }

  return { items, skipped }
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
): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    const file = await entryFile(entry)
    if (!file) {
      out.skipped.push({ name: path, reason: 'could not be read' })
      return
    }
    const { item, skipped } = await toItem(file, path)
    if (item) out.items.push(item)
    if (skipped) out.skipped.push(skipped)
    return
  }

  if (entry.isDirectory && !entry.name.startsWith('.')) {
    for (const child of await readAllEntries(entry)) {
      await walkEntry(child, path, out)
    }
  }
}

/**
 * Build import items from a drop, descending into any dropped folders. Falls
 * back to the flat `dataTransfer.files` list where the entry API is missing.
 */
export async function selectionFromDataTransfer(
  transfer: DataTransfer,
): Promise<ImportSelection> {
  const entries: FileSystemEntryLike[] = []
  for (const item of Array.from(transfer.items ?? [])) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  if (!entries.length) return await selectionFromFiles(transfer.files)

  const out: ImportSelection = { items: [], skipped: [] }
  for (const entry of entries) await walkEntry(entry, '', out)
  return out
}

/** Does this drag carry files (rather than a note being dragged within the app)? */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types ?? []).includes('Files')
}
