// The queue itself: what is waiting, what is running, and who is owed an answer.
//
// Execution happens here, in the browser, with the key that is already in this
// browser. A server-side worker is planned; the run records this writes are the
// contract it will read, which is why they live in the library rather than in
// component state.

import { useCallback, useEffect, useRef, useState } from 'react'
import { advance, executeAndRecord, recordToolResult, type RunContext } from './runner'
import {
  clampConcurrency,
  loadQueueSettings,
  saveQueueSettings,
  type QueueSettings,
} from './settings'
import { deleteRun, loadIndex, newRunId, readRun, saveRun } from './store'
import { FINISHED, type Run, type RunStatus, type RunSummary } from './types'
import type { AssistantSettings } from '../ai/types'

interface UseQueueOptions {
  dir: FileSystemDirectoryHandle | null
  /** Live assistant settings — provider, model, key, memory. */
  settings: AssistantSettings
  /** A run changed the library, so the note tree should reload. */
  onMutated: () => void
}

/** Trim a prompt into something that fits a list row. */
function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n').find((l) => l.trim())?.trim() ?? 'Untitled run'
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

export function useQueue({ dir, settings, onMutated }: UseQueueOptions) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [queueSettings, setQueueSettings] = useState<QueueSettings>(loadQueueSettings)
  const [loaded, setLoaded] = useState(false)

  const dirRef = useRef(dir)
  dirRef.current = dir
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const queueSettingsRef = useRef(queueSettings)
  queueSettingsRef.current = queueSettings

  /** Runs executing right now, and how to stop them. */
  const active = useRef(new Map<string, AbortController>())
  /** Guards the scheduler against being re-entered by its own state updates. */
  const pumping = useRef(false)

  const refresh = useCallback(async () => {
    const d = dirRef.current
    if (!d) {
      setRuns([])
      return []
    }
    const index = await loadIndex(d)
    setRuns(index.runs)
    return index.runs
  }, [])

  // ---- Load, and clean up after a tab that went away mid-run ----
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setRuns([])
    active.current.clear()
    if (!dir) return
    void (async () => {
      const index = await loadIndex(dir)
      if (cancelled) return

      // A run marked "running" with no worker behind it is a tab that was
      // closed, reloaded, or crashed. Say so plainly and offer it back rather
      // than leaving a spinner that will never stop.
      const stranded = index.runs.filter((r) => r.status === 'running')
      for (const row of stranded) {
        const run = await readRun(dir, row.id)
        if (!run) continue
        run.status = 'failed'
        run.error =
          'Interrupted — the browser stopped executing this run (the tab was closed or reloaded). Resume it to carry on from where it got to.'
        // Also the summary, not just the error: the summary is what the list
        // row shows, and a row that says "Failed" and nothing else makes the
        // reader open it to find out whether they broke something.
        run.summary = 'Interrupted when the tab closed. Resume to carry on.'
        run.finishedAt = Date.now()
        await saveRun(dir, run)
      }
      if (cancelled) return
      setRuns((await loadIndex(dir)).runs)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [dir])

  const updateQueueSettings = useCallback((patch: Partial<QueueSettings>) => {
    setQueueSettings((prev) => {
      const next = {
        ...prev,
        ...patch,
        ...(patch.concurrency !== undefined
          ? { concurrency: clampConcurrency(patch.concurrency) }
          : {}),
      }
      saveQueueSettings(next)
      return next
    })
  }, [])

  // ---- Executing one run ----
  const execute = useCallback(
    async (id: string) => {
      const d = dirRef.current
      if (!d || active.current.has(id)) return
      const run = await readRun(d, id)
      if (!run) return

      const controller = new AbortController()
      active.current.set(id, controller)

      run.status = 'running'
      run.startedAt = run.startedAt ?? Date.now()
      run.question = undefined
      run.pendingPreview = undefined
      run.error = undefined
      await saveRun(d, run)
      await refresh()

      const ctx: RunContext = {
        dir: d,
        run,
        settings: settingsRef.current,
        inbox: queueSettingsRef.current.inbox,
        signal: controller.signal,
        onTurn: async () => {
          await saveRun(d, run)
          await refresh()
        },
      }

      let wrote = run.writes.length
      try {
        const outcome = await advance(ctx)
        switch (outcome.kind) {
          case 'done':
            run.status = 'succeeded'
            run.summary = outcome.summary
            run.finishedAt = Date.now()
            break
          case 'needs-approval':
            run.status = 'needs-approval'
            run.summary = `Waiting for you: ${outcome.preview.summary}`
            break
          case 'needs-input':
            run.status = 'needs-input'
            run.summary = outcome.question
            break
          case 'cancelled':
            run.status = 'cancelled'
            run.summary = 'Cancelled.'
            run.finishedAt = Date.now()
            break
          case 'failed':
            run.status = 'failed'
            run.error = outcome.error
            run.summary = outcome.error
            run.finishedAt = Date.now()
            break
        }
      } catch (e) {
        const err = e as Error
        run.status = err.name === 'AbortError' ? 'cancelled' : 'failed'
        run.error = err.name === 'AbortError' ? undefined : err.message
        run.summary = err.name === 'AbortError' ? 'Cancelled.' : err.message
        run.finishedAt = Date.now()
      } finally {
        active.current.delete(id)
        await saveRun(d, run)
        await refresh()
        if (run.writes.length !== wrote) {
          wrote = run.writes.length
          onMutated()
        }
      }
    },
    [onMutated, refresh],
  )

  // ---- The scheduler ----
  // Start as many queued runs as the concurrency setting allows. Re-runs on
  // every list change, which is also every time a run finishes and frees a slot.
  useEffect(() => {
    if (!loaded || !dir || pumping.current) return
    const free = queueSettings.concurrency - active.current.size
    if (free <= 0) return
    const next = runs
      .filter((r) => r.status === 'queued' && !active.current.has(r.id))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, free)
    if (!next.length) return

    pumping.current = true
    void (async () => {
      try {
        // Deliberately not awaited together: each execute() drives its own run
        // to completion, and the point of concurrency is that they overlap.
        for (const row of next) void execute(row.id)
      } finally {
        pumping.current = false
      }
    })()
  }, [runs, loaded, dir, queueSettings.concurrency, execute])

  // ---- Commands ----
  const enqueue = useCallback(
    async (prompt: string, contextPath?: string) => {
      const d = dirRef.current
      const text = prompt.trim()
      if (!d || !text) return null
      const run: Run = {
        id: newRunId(),
        title: titleFrom(text),
        prompt: text,
        status: 'queued',
        createdAt: Date.now(),
        contextPath,
        messages: [{ id: `u${Date.now()}`, role: 'user', content: text }],
        writes: [],
        attempt: 1,
      }
      await saveRun(d, run)
      await refresh()
      return run.id
    },
    [refresh],
  )

  const cancel = useCallback(
    async (id: string) => {
      const controller = active.current.get(id)
      if (controller) {
        controller.abort()
        return
      }
      // Not running: cancel it where it stands (queued, or parked on a person).
      const d = dirRef.current
      if (!d) return
      const run = await readRun(d, id)
      if (!run || FINISHED.includes(run.status)) return
      run.status = 'cancelled'
      run.summary = 'Cancelled.'
      run.finishedAt = Date.now()
      await saveRun(d, run)
      await refresh()
    },
    [refresh],
  )

  /** Approve or reject the write a run is parked on, then let it carry on. */
  const decide = useCallback(
    async (id: string, approve: boolean) => {
      const d = dirRef.current
      if (!d) return
      const run = await readRun(d, id)
      if (!run || run.status !== 'needs-approval') return
      const call = run.pendingCalls?.[0]
      if (!call) return

      const ctx: RunContext = {
        dir: d,
        run,
        settings: settingsRef.current,
        inbox: queueSettingsRef.current.inbox,
        signal: new AbortController().signal,
        onTurn: async () => {},
      }
      if (approve) {
        await executeAndRecord(ctx, call)
        onMutated()
      } else {
        recordToolResult(
          run,
          call,
          'The user declined this change. Do not try it again; work within the inbox folder or finish without it.',
          true,
        )
      }
      run.pendingCalls?.shift()
      run.pendingPreview = undefined
      run.status = 'queued' // back in line; the scheduler picks it up
      await saveRun(d, run)
      await refresh()
    },
    [onMutated, refresh],
  )

  /** Answer the question a run asked, then let it carry on. */
  const reply = useCallback(
    async (id: string, answer: string) => {
      const d = dirRef.current
      const text = answer.trim()
      if (!d || !text) return
      const run = await readRun(d, id)
      if (!run || run.status !== 'needs-input') return
      const call = run.pendingCalls?.[0]
      if (!call) return

      recordToolResult(run, call, text)
      run.pendingCalls?.shift()
      run.question = undefined
      run.status = 'queued'
      await saveRun(d, run)
      await refresh()
    },
    [refresh],
  )

  /** Put a stopped run back in the queue with its transcript intact. */
  const resume = useCallback(
    async (id: string) => {
      const d = dirRef.current
      if (!d) return
      const run = await readRun(d, id)
      if (!run) return
      run.status = 'queued'
      run.error = undefined
      run.finishedAt = undefined
      run.attempt += 1
      await saveRun(d, run)
      await refresh()
    },
    [refresh],
  )

  /** Start again from the original instruction, as a new run. */
  const rerun = useCallback(
    async (id: string) => {
      const d = dirRef.current
      if (!d) return null
      const previous = await readRun(d, id)
      if (!previous) return null
      const run: Run = {
        id: newRunId(),
        title: previous.title,
        prompt: previous.prompt,
        status: 'queued',
        createdAt: Date.now(),
        contextPath: previous.contextPath,
        messages: [{ id: `u${Date.now()}`, role: 'user', content: previous.prompt }],
        writes: [],
        attempt: 1,
        parentRunId: previous.id,
      }
      await saveRun(d, run)
      await refresh()
      return run.id
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      const d = dirRef.current
      if (!d) return
      active.current.get(id)?.abort()
      await deleteRun(d, id)
      await refresh()
    },
    [refresh],
  )

  const open = useCallback(async (id: string): Promise<Run | null> => {
    const d = dirRef.current
    return d ? await readRun(d, id) : null
  }, [])

  const counts = {
    waiting: runs.filter((r) => r.status === 'needs-approval' || r.status === 'needs-input').length,
    running: runs.filter((r) => r.status === 'running').length,
    queued: runs.filter((r) => r.status === 'queued').length,
  }

  return {
    runs,
    counts,
    settings: queueSettings,
    updateSettings: updateQueueSettings,
    enqueue,
    cancel,
    decide,
    reply,
    resume,
    rerun,
    remove,
    open,
    refresh,
  }
}

export type QueueApi = ReturnType<typeof useQueue>
export type { Run, RunStatus, RunSummary }
