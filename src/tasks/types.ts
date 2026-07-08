/** Todoist-style priority: 1 is highest, 4 is the default "no priority". */
export type Priority = 1 | 2 | 3 | 4

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface Recurrence {
  freq: RecurrenceFreq
  /** Every N days/weeks/months/years (≥ 1). */
  interval: number
}

export interface Task {
  id: string
  title: string
  /** Project the task belongs to; null = Inbox. */
  projectId: string | null
  /** Local due date "YYYY-MM-DD", or null for undated. */
  due: string | null
  priority: Priority
  /** Completing a recurring task rolls `due` forward instead of completing. */
  recurrence: Recurrence | null
  /** The note this task was captured from, if any. */
  source?: { noteId: string }
  completedAt: number | null
  /** Soft-delete timestamp: set = in the bin (purged after 30 days). */
  deletedAt?: number | null
  createdAt: number
}

export interface Project {
  id: string
  name: string
  color: string
}

export interface TaskStore {
  version: 1
  tasks: Task[]
  projects: Project[]
}
