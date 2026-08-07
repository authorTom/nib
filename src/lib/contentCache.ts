import * as library from '../fs/library'
import type { NoteFile } from '../fs/library'

/**
 * Note bodies keyed by `id::updatedAt`, so an edit invalidates its own entry.
 * Search and the backlink index both walk every note; sharing one cache means
 * the library is read once per change rather than once per feature.
 */
const cache = new Map<string, string>()
const MAX_ENTRIES = 300

export async function readCached(
  dir: FileSystemDirectoryHandle,
  file: NoteFile,
): Promise<string> {
  const key = `${file.id}::${file.updatedAt}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Map preserves insertion order, so re-inserting marks this entry as the
    // most recently used and keeps the eviction below honest.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let content: string
  try {
    content = await library.readNote(dir, file.id)
  } catch {
    content = ''
  }
  cache.set(key, content)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return content
}

/**
 * Drop one note's entry after writing it.
 *
 * The cache key carries the `updatedAt` from the note tree, and the tree isn't
 * rebuilt on every autosave — so without this a second edit would keep hitting
 * the entry cached from the first, and search and backlinks would go on
 * matching text the file no longer contains.
 */
export function invalidateCached(id: string): void {
  const prefix = `${id}::`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/** Drop everything — used when switching libraries. */
export function clearContentCache(): void {
  cache.clear()
}
