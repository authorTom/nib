// Bookmark persistence: .nib/bookmarks.json in the vault, alongside tasks.

import type { BookmarkStore } from './types'

const NIB_DIR = '.nib'
const BOOKMARKS_FILE = 'bookmarks.json'

export const EMPTY_STORE: BookmarkStore = {
  version: 1,
  bookmarks: [],
  collections: [],
}

export async function loadBookmarkStore(
  dir: FileSystemDirectoryHandle,
): Promise<BookmarkStore> {
  try {
    const folder = await dir.getDirectoryHandle(NIB_DIR)
    const handle = await folder.getFileHandle(BOOKMARKS_FILE)
    const parsed = JSON.parse(await (await handle.getFile()).text())
    if (
      parsed?.version === 1 &&
      Array.isArray(parsed.bookmarks) &&
      Array.isArray(parsed.collections)
    ) {
      return parsed as BookmarkStore
    }
  } catch {
    // Missing or unreadable — start fresh.
  }
  return EMPTY_STORE
}

export async function saveBookmarkStore(
  dir: FileSystemDirectoryHandle,
  store: BookmarkStore,
): Promise<void> {
  const folder = await dir.getDirectoryHandle(NIB_DIR, { create: true })
  const handle = await folder.getFileHandle(BOOKMARKS_FILE, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(store, null, 2))
  await writable.close()
}
