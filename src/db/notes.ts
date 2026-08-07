// Small IndexedDB key/value store used only to remember the chosen library
// folder across reloads. FileSystemDirectoryHandle objects are structured-
// cloneable, so they can be stored directly in IndexedDB.

// NOTE: a dedicated database name (not the legacy Dexie "notes-app" DB, which
// Dexie opens at an internal version of 10 — reopening it here at version 1
// would fail with a VersionError).
//
// These two names say "vault" because that is what a library used to be called.
// They are storage keys, not prose: renaming them would point at a fresh empty
// database, losing the saved folder handle and sending every existing user back
// to the "open folder" screen. They are invisible to users, so they stay.
const DB_NAME = 'notes-vault-meta'
const STORE = 'kv'
const HANDLE_KEY = 'vault-handle'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

export async function saveLibraryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(handle, HANDLE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// OPFS handles can't be structured-cloned into IndexedDB in Safari/WebKit, and
// the OPFS library is a single fixed location anyway — so instead of persisting a
// handle we just remember (in localStorage) that the user opened it, and
// re-acquire the directory on startup.
//
// Pre-rename key name, kept deliberately: renaming it would read as "this user
// never opened the in-browser library" and their notes would appear to vanish.
const OPFS_FLAG = 'notes-opfs-vault'

export function rememberOpfsLibrary(): void {
  try {
    localStorage.setItem(OPFS_FLAG, '1')
  } catch {
    // Private mode or storage disabled — the library still works this session.
  }
}

export function hasOpfsLibrary(): boolean {
  try {
    return localStorage.getItem(OPFS_FLAG) === '1'
  } catch {
    return false
  }
}

export async function loadLibraryHandle(): Promise<FileSystemDirectoryHandle | null> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    // If the metadata store can't be opened, treat it as "no saved library"
    // rather than letting the error hang app startup.
    return null
  }
  try {
    return await new Promise<FileSystemDirectoryHandle | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(HANDLE_KEY)
        req.onsuccess = () =>
          resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null)
        req.onerror = () => reject(req.error)
      },
    )
  } catch {
    return null
  } finally {
    db.close()
  }
}
