// Small IndexedDB key/value store used only to remember the chosen vault
// folder across reloads. FileSystemDirectoryHandle objects are structured-
// cloneable, so they can be stored directly in IndexedDB.

// NOTE: a dedicated database name (not the legacy Dexie "notes-app" DB, which
// Dexie opens at an internal version of 10 — reopening it here at version 1
// would fail with a VersionError).
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

export async function saveVaultHandle(
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
// the OPFS vault is a single fixed location anyway — so instead of persisting a
// handle we just remember (in localStorage) that the user opened it, and
// re-acquire the directory on startup.
const OPFS_FLAG = 'notes-opfs-vault'

export function rememberOpfsVault(): void {
  try {
    localStorage.setItem(OPFS_FLAG, '1')
  } catch {
    // Private mode or storage disabled — the vault still works this session.
  }
}

export function hasOpfsVault(): boolean {
  try {
    return localStorage.getItem(OPFS_FLAG) === '1'
  } catch {
    return false
  }
}

export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    // If the metadata store can't be opened, treat it as "no saved vault"
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
