// Task persistence: a single JSON file in a hidden ".nib" folder at the vault
// root, so tasks travel with the vault (sync, backup, Obsidian coexistence)
// and work identically on a disk folder and OPFS.

import type { TaskStore } from './types'

const NIB_DIR = '.nib'
const TASKS_FILE = 'tasks.json'

export const EMPTY_STORE: TaskStore = { version: 1, tasks: [], projects: [] }

export async function loadTaskStore(
  dir: FileSystemDirectoryHandle,
): Promise<TaskStore> {
  try {
    const folder = await dir.getDirectoryHandle(NIB_DIR)
    const handle = await folder.getFileHandle(TASKS_FILE)
    const parsed = JSON.parse(await (await handle.getFile()).text())
    if (
      parsed?.version === 1 &&
      Array.isArray(parsed.tasks) &&
      Array.isArray(parsed.projects)
    ) {
      return parsed as TaskStore
    }
  } catch {
    // Missing or unreadable — start fresh.
  }
  return EMPTY_STORE
}

export async function saveTaskStore(
  dir: FileSystemDirectoryHandle,
  store: TaskStore,
): Promise<void> {
  const folder = await dir.getDirectoryHandle(NIB_DIR, { create: true })
  const handle = await folder.getFileHandle(TASKS_FILE, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(store, null, 2))
  await writable.close()
}
