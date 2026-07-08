import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_STORE, loadTaskStore, saveTaskStore } from './store'
import { nextOccurrence } from './dates'
import type { Priority, Recurrence, Task, TaskStore } from './types'

let counter = 0
const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

/** Binned tasks older than this are purged when the store loads. */
const TRASH_RETENTION_MS = 30 * 86_400_000

const PROJECT_COLORS = [
  '#ef4444', '#f59e0b', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
]

export interface AddTaskInput {
  title: string
  due?: string | null
  projectId?: string | null
  priority?: Priority
  recurrence?: Recurrence | null
  source?: { noteId: string }
}

/** Task state backed by .nib/tasks.json in the vault, saved with a debounce. */
export function useTasks(dir: FileSystemDirectoryHandle | null) {
  const [store, setStore] = useState<TaskStore>(EMPTY_STORE)

  const dirRef = useRef(dir)
  dirRef.current = dir
  const latest = useRef(store)
  latest.current = store
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // (Re)load whenever the vault changes.
  useEffect(() => {
    let cancelled = false
    setStore(EMPTY_STORE)
    dirty.current = false
    if (!dir) return
    void loadTaskStore(dir).then((s) => {
      if (cancelled) return
      const cutoff = Date.now() - TRASH_RETENTION_MS
      const kept = s.tasks.filter((t) => !t.deletedAt || t.deletedAt > cutoff)
      setStore(kept.length === s.tasks.length ? s : { ...s, tasks: kept })
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
      void saveTaskStore(d, latest.current)
    }
  }, [])

  const persistSoon = useCallback(() => {
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }, [flush])

  // Best-effort save when the tab is hidden or closed.
  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [flush])

  const mutate = useCallback(
    (fn: (s: TaskStore) => TaskStore) => {
      setStore((prev) => fn(prev))
      persistSoon()
    },
    [persistSoon],
  )

  const addTask = useCallback(
    (input: AddTaskInput) => {
      const title = input.title.replace(/\s+/g, ' ').trim()
      if (!title) return
      const task: Task = {
        id: uid('t'),
        title,
        projectId: input.projectId ?? null,
        due: input.due ?? null,
        priority: input.priority ?? 4,
        recurrence: input.recurrence ?? null,
        ...(input.source ? { source: input.source } : {}),
        completedAt: null,
        createdAt: Date.now(),
      }
      mutate((s) => ({ ...s, tasks: [...s.tasks, task] }))
    },
    [mutate],
  )

  const updateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      mutate((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }))
    },
    [mutate],
  )

  const toggleComplete = useCallback(
    (id: string) => {
      mutate((s) => ({
        ...s,
        tasks: s.tasks.map((t) => {
          if (t.id !== id) return t
          if (t.completedAt) return { ...t, completedAt: null }
          // Recurring tasks roll to the next occurrence instead of completing.
          if (t.recurrence && t.due) {
            return { ...t, due: nextOccurrence(t.due, t.recurrence) }
          }
          return { ...t, completedAt: Date.now() }
        }),
      }))
    },
    [mutate],
  )

  /** Soft delete: the task moves to the bin and can be restored. */
  const deleteTask = useCallback(
    (id: string) => {
      mutate((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, deletedAt: Date.now() } : t,
        ),
      }))
    },
    [mutate],
  )

  const restoreTask = useCallback(
    (id: string) => {
      mutate((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, deletedAt: null } : t)),
      }))
    },
    [mutate],
  )

  const deleteForever = useCallback(
    (id: string) => {
      mutate((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }))
    },
    [mutate],
  )

  const emptyTaskBin = useCallback(() => {
    mutate((s) => ({ ...s, tasks: s.tasks.filter((t) => !t.deletedAt) }))
  }, [mutate])

  /** Move all completed tasks to the bin (recoverable). */
  const clearCompleted = useCallback(() => {
    mutate((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.completedAt && !t.deletedAt ? { ...t, deletedAt: Date.now() } : t,
      ),
    }))
  }, [mutate])

  const addProject = useCallback(
    (name: string): string => {
      const id = uid('p')
      mutate((s) => ({
        ...s,
        projects: [
          ...s.projects,
          {
            id,
            name: name.trim() || 'New project',
            color: PROJECT_COLORS[s.projects.length % PROJECT_COLORS.length],
          },
        ],
      }))
      return id
    },
    [mutate],
  )

  const renameProject = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      mutate((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      }))
    },
    [mutate],
  )

  /** Delete a project; its tasks move back to the Inbox. */
  const deleteProject = useCallback(
    (id: string) => {
      mutate((s) => ({
        version: 1,
        projects: s.projects.filter((p) => p.id !== id),
        tasks: s.tasks.map((t) =>
          t.projectId === id ? { ...t, projectId: null } : t,
        ),
      }))
    },
    [mutate],
  )

  return useMemo(
    () => ({
      store,
      addTask,
      updateTask,
      toggleComplete,
      deleteTask,
      restoreTask,
      deleteForever,
      emptyTaskBin,
      clearCompleted,
      addProject,
      renameProject,
      deleteProject,
    }),
    [
      store,
      addTask,
      updateTask,
      toggleComplete,
      deleteTask,
      restoreTask,
      deleteForever,
      emptyTaskBin,
      clearCompleted,
      addProject,
      renameProject,
      deleteProject,
    ],
  )
}

export type TasksApi = ReturnType<typeof useTasks>
