// Bookmark persistence: bookmarks.json in the library's hidden data folder,
// alongside tasks.

import { readDataJson, writeDataJson } from '../fs/appData'
import type { BookmarkStore } from './types'

const BOOKMARKS_FILE = 'bookmarks.json'

export const EMPTY_STORE: BookmarkStore = {
  version: 1,
  bookmarks: [],
  collections: [],
}

export async function loadBookmarkStore(
  dir: FileSystemDirectoryHandle,
): Promise<BookmarkStore> {
  const parsed = (await readDataJson(dir, BOOKMARKS_FILE)) as BookmarkStore | null
  if (
    parsed?.version === 1 &&
    Array.isArray(parsed.bookmarks) &&
    Array.isArray(parsed.collections)
  ) {
    return parsed
  }
  return EMPTY_STORE
}

export async function saveBookmarkStore(
  dir: FileSystemDirectoryHandle,
  store: BookmarkStore,
): Promise<void> {
  await writeDataJson(dir, BOOKMARKS_FILE, store)
}
