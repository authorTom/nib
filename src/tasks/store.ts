// Task persistence: a single JSON file in a hidden folder at the library root,
// so tasks travel with the library (sync, backup, coexistence with other
// Markdown editors) and work identically on a disk folder and OPFS.

import { readDataJson, writeDataJson } from '../fs/appData'
import type { TaskStore } from './types'

const TASKS_FILE = 'tasks.json'

export const EMPTY_STORE: TaskStore = { version: 1, tasks: [], projects: [] }

export async function loadTaskStore(
  dir: FileSystemDirectoryHandle,
): Promise<TaskStore> {
  const parsed = (await readDataJson(dir, TASKS_FILE)) as TaskStore | null
  if (
    parsed?.version === 1 &&
    Array.isArray(parsed.tasks) &&
    Array.isArray(parsed.projects)
  ) {
    return parsed
  }
  return EMPTY_STORE
}

export async function saveTaskStore(
  dir: FileSystemDirectoryHandle,
  store: TaskStore,
): Promise<void> {
  await writeDataJson(dir, TASKS_FILE, store)
}
