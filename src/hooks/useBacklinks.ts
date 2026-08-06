import { useEffect, useState } from 'react'
import type { NoteFile } from '../fs/vault'
import { readCached } from '../lib/contentCache'
import { findBacklinks, type Backlink } from '../lib/wikilinks'

/**
 * Notes that link to `targetId` via `[[wikilinks]]`.
 *
 * Rebuilds whenever the tree or the target changes, reading through the shared
 * content cache so an unchanged vault costs nothing after the first pass. The
 * work is deferred behind a short timer: switching notes quickly shouldn't
 * queue a full vault scan per keystroke of navigation.
 */
export function useBacklinks(
  dir: FileSystemDirectoryHandle | null,
  files: NoteFile[],
  targetId: string | null,
): Backlink[] {
  const [backlinks, setBacklinks] = useState<Backlink[]>([])

  useEffect(() => {
    if (!dir || !targetId) {
      setBacklinks([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const contents = new Map<string, string>()
      for (const file of files) {
        if (cancelled) return
        if (file.id === targetId) continue
        contents.set(file.id, await readCached(dir, file))
      }
      if (!cancelled) setBacklinks(findBacklinks(targetId, files, contents))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [dir, files, targetId])

  return backlinks
}
