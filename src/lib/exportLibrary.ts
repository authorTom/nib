// Export the whole knowledge base as one ZIP.
//
// Built in the browser rather than on the server, so it works identically for
// all three backends — a local folder, the in-browser OPFS library, and the
// server library — instead of only the one that has a server behind it.

import { collectFiles } from '../fs/library'
import { createZip, downloadBlob, type ZipEntry } from './zip'

export interface ExportOptions {
  /** Include `.trash` and `.history` — a true backup rather than a clean copy. */
  includeHidden?: boolean
}

export interface ExportProgress {
  phase: 'reading' | 'compressing'
  done: number
  total: number
}

export interface ExportResult {
  fileName: string
  fileCount: number
  bytes: number
}

/** "My Notes" → "my-notes-2026-07-30.zip" */
function archiveName(libraryName: string): string {
  const slug =
    libraryName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'library'
  const today = new Date()
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
  return `${slug}-${stamp}.zip`
}

/**
 * Read every file in the library, zip it, and hand the archive to the browser as
 * a download. Progress is reported in two phases because reading a server library
 * is one request per file and can dominate the wait.
 */
export async function exportLibraryZip(
  dir: FileSystemDirectoryHandle,
  libraryName: string,
  options: ExportOptions = {},
  onProgress?: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  let read = 0
  const files = await collectFiles(dir, options, () => {
    read += 1
    // Total is unknown until the walk finishes, so report the running count as
    // both — the bar stays indeterminate during this phase.
    onProgress?.({ phase: 'reading', done: read, total: read })
  })

  if (!files.length) throw new Error('There is nothing in this library to export yet.')

  const entries: ZipEntry[] = files.map((file) => ({
    path: file.path,
    content: file.content,
    modified: file.modified,
  }))

  const blob = await createZip(entries, (done, total) =>
    onProgress?.({ phase: 'compressing', done, total }),
  )

  const fileName = archiveName(libraryName)
  downloadBlob(blob, fileName)
  return { fileName, fileCount: files.length, bytes: blob.size }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
