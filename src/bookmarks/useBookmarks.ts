import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_STORE, loadBookmarkStore, saveBookmarkStore } from './store'
import { domainOf } from './url'
import { PALETTE } from '../lib/palette'
import type { Bookmark, BookmarkStore } from './types'

let counter = 0
const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

export interface AddBookmarkInput {
  url: string
  title?: string
  comment?: string
  collectionId?: string | null
  source?: { noteId: string }
}

/** Bookmark state backed by .nib/bookmarks.json, saved with a debounce. */
export function useBookmarks(dir: FileSystemDirectoryHandle | null) {
  const [store, setStore] = useState<BookmarkStore>(EMPTY_STORE)

  const dirRef = useRef(dir)
  dirRef.current = dir
  const latest = useRef(store)
  latest.current = store
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setStore(EMPTY_STORE)
    dirty.current = false
    if (!dir) return
    void loadBookmarkStore(dir).then((s) => {
      if (!cancelled) setStore(s)
    })
    return () => {
      cancelled = true
    }
  }, [dir])

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    const d = dirRef.current
    if (d && dirty.current) {
      dirty.current = false
      void saveBookmarkStore(d, latest.current)
    }
  }, [])

  const persistSoon = useCallback(() => {
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }, [flush])

  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [flush])

  const mutate = useCallback(
    (fn: (s: BookmarkStore) => BookmarkStore) => {
      setStore((prev) => fn(prev))
      persistSoon()
    },
    [persistSoon],
  )

  /** Returns the new bookmark's id (so the UI can open it for editing). */
  const addBookmark = useCallback(
    (input: AddBookmarkInput): string => {
      const id = uid('b')
      const bookmark: Bookmark = {
        id,
        url: input.url,
        title: (input.title ?? '').trim() || domainOf(input.url),
        comment: input.comment ?? '',
        collectionId: input.collectionId ?? null,
        ...(input.source ? { source: input.source } : {}),
        createdAt: Date.now(),
      }
      mutate((s) => ({ ...s, bookmarks: [...s.bookmarks, bookmark] }))
      return id
    },
    [mutate],
  )

  const updateBookmark = useCallback(
    (id: string, patch: Partial<Bookmark>) => {
      mutate((s) => ({
        ...s,
        bookmarks: s.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }))
    },
    [mutate],
  )

  const deleteBookmark = useCallback(
    (id: string) => {
      mutate((s) => ({ ...s, bookmarks: s.bookmarks.filter((b) => b.id !== id) }))
    },
    [mutate],
  )

  const addCollection = useCallback(
    (name: string): string => {
      const id = uid('c')
      mutate((s) => ({
        ...s,
        collections: [
          ...s.collections,
          {
            id,
            name: name.trim() || 'New collection',
            color: PALETTE[s.collections.length % PALETTE.length],
          },
        ],
      }))
      return id
    },
    [mutate],
  )

  const renameCollection = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      mutate((s) => ({
        ...s,
        collections: s.collections.map((c) =>
          c.id === id ? { ...c, name: trimmed } : c,
        ),
      }))
    },
    [mutate],
  )

  /** Delete a collection; its bookmarks become unfiled. */
  const deleteCollection = useCallback(
    (id: string) => {
      mutate((s) => ({
        version: 1,
        collections: s.collections.filter((c) => c.id !== id),
        bookmarks: s.bookmarks.map((b) =>
          b.collectionId === id ? { ...b, collectionId: null } : b,
        ),
      }))
    },
    [mutate],
  )

  return useMemo(
    () => ({
      store,
      addBookmark,
      updateBookmark,
      deleteBookmark,
      addCollection,
      renameCollection,
      deleteCollection,
    }),
    [
      store,
      addBookmark,
      updateBookmark,
      deleteBookmark,
      addCollection,
      renameCollection,
      deleteCollection,
    ],
  )
}

export type BookmarksApi = ReturnType<typeof useBookmarks>
