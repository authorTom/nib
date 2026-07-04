import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadVaultHandle,
  saveVaultHandle,
  rememberOpfsVault,
  hasOpfsVault,
} from '../db/notes'
import * as vault from '../fs/vault'
import * as history from '../fs/history'
import type { TreeNode, TrashItem } from '../fs/vault'
import type { HistoryItem } from '../fs/history'

export type VaultStatus =
  | 'loading'
  | 'unsupported'
  | 'no-vault'
  | 'needs-permission'
  | 'ready'

const ACTIVE_KEY = 'notes-active-id'
const SAVE_DEBOUNCE_MS = 500
// While editing, snapshot the previous on-disk version at most this often.
const SNAPSHOT_INTERVAL_MS = 5 * 60_000
// Cap the search content cache so a large vault can't grow it without bound.
const CONTENT_CACHE_MAX = 300

export function useNotes() {
  const [status, setStatus] = useState<VaultStatus>('loading')
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState<string | null>(null)

  const files = useMemo(() => vault.flattenFiles(tree), [tree])

  // ---- Startup: restore a previously chosen vault ----
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (!vault.isVaultSupported()) {
          setStatus('unsupported')
          return
        }
        // Chromium: a previously picked on-disk folder is restored from its
        // persisted handle.
        const saved = await loadVaultHandle()
        if (cancelled) return
        if (saved) {
          const granted = await vault.ensurePermission(saved, false)
          if (cancelled) return
          setDir(saved)
          setStatus(granted ? 'ready' : 'needs-permission')
          return
        }
        // Safari/Firefox: re-open the OPFS vault (a fixed location, so no stored
        // handle is needed) if the user opened it before.
        if (!vault.supportsDiskPicker() && vault.supportsOpfs() && hasOpfsVault()) {
          const handle = await vault.openOpfsVault()
          if (cancelled) return
          setDir(handle)
          setStatus('ready')
          return
        }
        setStatus('no-vault')
      } catch {
        // Never leave the app stuck on the loading screen.
        if (!cancelled) setStatus('no-vault')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async (d: FileSystemDirectoryHandle) => {
    const t = await vault.buildTree(d)
    setTree(t)
    return vault.flattenFiles(t)
  }, [])

  // ---- Load note list once the vault is ready ----
  useEffect(() => {
    if (status !== 'ready' || !dir) return
    let cancelled = false
    void (async () => {
      const list = await refresh(dir)
      if (cancelled) return
      const saved = localStorage.getItem(ACTIVE_KEY)
      const pick =
        saved && list.some((n) => n.id === saved) ? saved : list[0]?.id ?? null
      setActiveId(pick)
    })()
    return () => {
      cancelled = true
    }
  }, [status, dir, refresh])

  // ---- Load the active note's content from disk ----
  useEffect(() => {
    if (!dir || !activeId) {
      setActiveContent(null)
      return
    }
    let cancelled = false
    setActiveContent(null)
    localStorage.setItem(ACTIVE_KEY, activeId)
    void (async () => {
      try {
        const text = await vault.readNote(dir, activeId)
        if (!cancelled) setActiveContent(text)
      } catch {
        if (!cancelled) setActiveContent('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dir, activeId])

  // ---- Connect / reconnect ----
  const connect = useCallback(async () => {
    let handle: FileSystemDirectoryHandle
    try {
      handle = await vault.pickVault()
    } catch {
      // User dismissed the picker — leave state untouched.
      return
    }
    const granted = await vault.ensurePermission(handle, true)
    if (!granted) return
    // Remember the chosen vault for next launch. Disk handles persist in
    // IndexedDB; OPFS handles can't be cloned there (Safari), so we just record
    // a flag and re-open the fixed OPFS location on startup. A persistence
    // failure must not block opening the vault for this session.
    try {
      if (vault.supportsDiskPicker()) {
        await saveVaultHandle(handle)
      } else {
        rememberOpfsVault()
      }
    } catch {
      // Best effort — continue with the open vault even if it won't be remembered.
    }
    setTree([])
    setActiveId(null)
    setActiveContent(null)
    setDir(handle)
    setStatus('ready')
  }, [])

  const reconnect = useCallback(async () => {
    if (!dir) return
    const granted = await vault.ensurePermission(dir, true)
    if (granted) setStatus('ready')
  }, [dir])

  // ---- Debounced content persistence ----
  const pending = useRef<{ id: string; content: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Per-note timestamp of the last history snapshot (throttles edit snapshots).
  const lastSnapshotAt = useRef<Map<string, number>>(new Map())

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    const p = pending.current
    if (!p || !dir) return
    pending.current = null
    // Periodically keep the version being overwritten, so an editing session
    // leaves a trail of restore points (at most one per SNAPSHOT_INTERVAL_MS).
    const last = lastSnapshotAt.current.get(p.id) ?? 0
    if (Date.now() - last > SNAPSHOT_INTERVAL_MS) {
      lastSnapshotAt.current.set(p.id, Date.now())
      try {
        const prev = await vault.readNote(dir, p.id)
        if (prev.trim() && prev !== p.content) {
          await history.snapshotNote(dir, p.id, prev, 'edit')
        }
      } catch {
        // New note — nothing to snapshot.
      }
    }
    await vault.writeNote(dir, p.id, p.content)
  }, [dir])

  const saveContent = useCallback(
    (content: string) => {
      if (!dir || !activeId) return
      // If a *different* note still has buffered edits, persist them now before
      // we reuse the single pending slot — otherwise those edits are lost.
      const prev = pending.current
      if (prev && prev.id !== activeId) {
        void vault.writeNote(dir, prev.id, prev.content)
      }
      pending.current = { id: activeId, content }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    [dir, activeId, flush],
  )

  // Best-effort: persist buffered edits when the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flush])

  // ---- CRUD ----
  const createNote = useCallback(
    async (folderPath = '') => {
      if (!dir) return
      const note = await vault.createNote(dir, folderPath)
      await refresh(dir)
      setActiveId(note.id)
    },
    [dir, refresh],
  )

  // Deleting moves the note to the recycle bin (.trash) rather than erasing it.
  const deleteNote = useCallback(
    async (id: string) => {
      if (!dir) return
      // Flush buffered edits first so the trashed copy is current, and so the
      // pending timer can't recreate the note after it's moved to the bin.
      await flush()
      await vault.trashNote(dir, id)
      const list = await refresh(dir)
      if (id === activeId) setActiveId(list[0]?.id ?? null)
    },
    [dir, flush, refresh, activeId],
  )

  // Rename the active note's file to match a new title (commit on blur/Enter).
  const renameActive = useCallback(
    async (newTitle: string) => {
      if (!dir || !activeId) return
      await flush() // ensure latest content is on disk before moving the file
      const newId = await vault.renameNote(dir, activeId, newTitle)
      if (newId !== activeId) await history.retargetHistory(dir, activeId, newId)
      await refresh(dir)
      if (newId !== activeId) setActiveId(newId)
    },
    [dir, activeId, flush, refresh],
  )

  const createFolder = useCallback(
    async (parentPath: string, name: string) => {
      if (!dir) return undefined
      const id = await vault.createFolder(dir, parentPath, name)
      await refresh(dir)
      return id
    },
    [dir, refresh],
  )

  const deleteFolder = useCallback(
    async (folderPath: string) => {
      if (!dir) return
      await flush() // persist any buffered edits to a note inside the folder
      await vault.trashFolder(dir, folderPath)
      const list = await refresh(dir)
      // If the open note lived in the deleted folder, pick another.
      if (activeId && !list.some((n) => n.id === activeId)) {
        setActiveId(list[0]?.id ?? null)
      }
    },
    [dir, flush, refresh, activeId],
  )

  const renameFolder = useCallback(
    async (folderPath: string, newName: string) => {
      if (!dir) return
      await flush() // persist any buffered edits before moving files
      const newPath = await vault.renameFolder(dir, folderPath, newName)
      await refresh(dir)
      // If the open note lived inside the folder, its path changed too.
      if (
        activeId &&
        (activeId === folderPath || activeId.startsWith(`${folderPath}/`))
      ) {
        setActiveId(newPath + activeId.slice(folderPath.length))
      }
    },
    [dir, flush, refresh, activeId],
  )

  const moveNote = useCallback(
    async (id: string, targetFolderPath: string) => {
      if (!dir) return
      if (id === activeId) await flush() // persist edits before moving the file
      const newId = await vault.moveNote(dir, id, targetFolderPath)
      if (newId !== id) await history.retargetHistory(dir, id, newId)
      await refresh(dir)
      if (id === activeId && newId !== id) setActiveId(newId)
    },
    [dir, activeId, flush, refresh],
  )

  // ---- Recycle bin ----
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])

  const loadTrash = useCallback(async () => {
    if (!dir) {
      setTrashItems([])
      return
    }
    setTrashItems(await vault.listTrash(dir))
  }, [dir])

  const restoreFromTrash = useCallback(
    async (trashName: string) => {
      if (!dir) return
      const newId = await vault.restoreTrash(dir, trashName)
      await refresh(dir)
      setTrashItems(await vault.listTrash(dir))
      if (newId) setActiveId(newId)
    },
    [dir, refresh],
  )

  const deleteFromTrash = useCallback(
    async (trashName: string) => {
      if (!dir) return
      await vault.deleteTrashItem(dir, trashName)
      setTrashItems(await vault.listTrash(dir))
    },
    [dir],
  )

  const emptyTrash = useCallback(async () => {
    if (!dir) return
    await vault.emptyTrash(dir)
    setTrashItems([])
  }, [dir])

  // ---- Version history (for the active note) ----
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])

  const loadHistory = useCallback(async () => {
    if (!dir || !activeId) {
      setHistoryItems([])
      return
    }
    await flush() // so the newest state is what a restore would snapshot
    setHistoryItems(await history.listHistory(dir, activeId))
  }, [dir, activeId, flush])

  const previewVersion = useCallback(
    async (snapName: string) => {
      if (!dir) return ''
      try {
        return await history.readSnapshot(dir, snapName)
      } catch {
        return ''
      }
    },
    [dir],
  )

  const restoreVersion = useCallback(
    async (snapName: string) => {
      if (!dir || !activeId) return
      await flush()
      const snapContent = await history.readSnapshot(dir, snapName)
      // Keep the current state as its own restore point before replacing it.
      try {
        const cur = await vault.readNote(dir, activeId)
        if (cur.trim() && cur !== snapContent) {
          await history.snapshotNote(dir, activeId, cur, 'restore')
        }
      } catch {
        // Note missing on disk — restore recreates it below.
      }
      lastSnapshotAt.current.set(activeId, Date.now())
      await vault.writeNote(dir, activeId, snapContent)
      setActiveContent(snapContent)
      await refresh(dir)
      setHistoryItems(await history.listHistory(dir, activeId))
    },
    [dir, activeId, flush, refresh],
  )

  const deleteVersion = useCallback(
    async (snapName: string) => {
      if (!dir || !activeId) return
      await history.deleteSnapshot(dir, snapName)
      setHistoryItems(await history.listHistory(dir, activeId))
    },
    [dir, activeId],
  )

  // ---- Search across the whole tree (title, path, and file contents) ----
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  // Cache file contents keyed by id + mtime so re-querying is cheap.
  const contentCache = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q || !dir) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const out: SearchResult[] = []
      for (const file of files) {
        if (cancelled) return
        const folderPath = file.id.includes('/')
          ? file.id.slice(0, file.id.lastIndexOf('/'))
          : ''
        const titleMatch =
          file.title.toLowerCase().includes(q) || folderPath.toLowerCase().includes(q)

        const key = `${file.id}::${file.updatedAt}`
        const cache = contentCache.current
        let content = cache.get(key)
        if (content === undefined) {
          try {
            content = await vault.readNote(dir, file.id)
          } catch {
            content = ''
          }
        } else {
          // Refresh recency (Map keeps insertion order → LRU eviction below).
          cache.delete(key)
        }
        cache.set(key, content)
        while (cache.size > CONTENT_CACHE_MAX) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }

        let snippet = ''
        let contentMatch = false
        if (!titleMatch) {
          const idx = content.toLowerCase().indexOf(q)
          if (idx >= 0) {
            contentMatch = true
            snippet = makeSnippet(content, idx, q.length)
          }
        }

        if (titleMatch || contentMatch) {
          out.push({ id: file.id, title: file.title, folderPath, snippet })
        }
      }
      if (!cancelled) setSearchResults(out)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, dir, files])

  const activeNote = files.find((n) => n.id === activeId) ?? null

  // Reload after the AI assistant changes files on disk: rebuild the tree and
  // re-read the open note's content, so an edit to the currently-open note shows
  // up immediately instead of only after switching away and back.
  const reload = useCallback(async () => {
    if (!dir) return
    const list = await refresh(dir)
    if (!activeId) return

    if (!list.some((n) => n.id === activeId)) {
      // The open note was deleted or moved by the change. Drop any buffered
      // edits so the debounced save can't recreate the file, then move on.
      if (pending.current?.id === activeId) {
        pending.current = null
        if (timer.current) {
          clearTimeout(timer.current)
          timer.current = undefined
        }
      }
      setActiveId(list[0]?.id ?? null)
      return
    }

    // Persist buffered edits before re-reading, so a keystroke made moments
    // before the AI change isn't clobbered by stale disk content. In the rare
    // case where the AI edited the very note being typed in, the user's
    // buffer wins — deterministic, and the editor never diverges from disk.
    await flush()
    try {
      setActiveContent(await vault.readNote(dir, activeId))
    } catch {
      // Transient read failure — keep showing the current content.
    }
  }, [dir, refresh, activeId, flush])

  return {
    status,
    vaultName: dir?.name ?? null,
    vaultDir: dir,
    reload,
    tree,
    notes: files,
    activeNote,
    activeId,
    activeContent,
    setActiveId,
    connect,
    reconnect,
    createNote,
    createFolder,
    deleteFolder,
    renameFolder,
    moveNote,
    deleteNote,
    saveContent,
    renameActive,
    trashItems,
    loadTrash,
    restoreFromTrash,
    deleteFromTrash,
    emptyTrash,
    historyItems,
    loadHistory,
    previewVersion,
    restoreVersion,
    deleteVersion,
    query,
    setQuery,
    searchResults,
  }
}

export interface SearchResult {
  id: string
  title: string
  folderPath: string
  snippet: string
}

function makeSnippet(content: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 25)
  const end = Math.min(content.length, idx + len + 45)
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) snippet = `…${snippet}`
  if (end < content.length) snippet = `${snippet}…`
  return snippet
}
