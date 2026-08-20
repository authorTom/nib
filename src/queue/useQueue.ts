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
import type { AssistantSettings, Provider } from '../ai/types'

interface UseQueueOptions {
  dir: FileSystemDirectoryHandle | null
  /** Live assistant settings — provider, model, key, memory. */
  settings: AssistantSettings
  /** A run changed the library, so the note tree should reload. */
  onMutated: () => void
  /**
   * A background run stopped without finishing.
   *
   * Background work that fails quietly is indistinguishable from background
   * work that never started, and the panel it lives in is usually closed by
   * the time it happens — so the app gets told, and says so.
   */
  onRunFailed?: (title: string, error: string) => void
}

/**
 * The settings a run executes under: the live ones, with the model it was
 * queued against put back.
 *
 * A run records its model when it is queued, so changing the model in the chat
 * panel doesn't re-point work that is already waiting, and a finished run can
 * say what produced it. Everything else — the key, memory, the inbox — is read
 * live, because those are properties of the browser doing the work rather than
 * of the job.
 */
function settingsFor(run: Run, settings: AssistantSettings): AssistantSettings {
  if (!run.provider || !run.model) return settings
  return {
    ...settings,
    provider: run.provider,
    models: { ...settings.models, [run.provider]: run.model },
  }
}

/**
 * Which runs should start right now.
 *
 * Pulled out of the effect so it can be tested without a browser: "why is
 * nothing running" is a question about this decision, and it should be
 * answerable without a React renderer and a provider key.
 *
 * Oldest first, so the queue is a queue.
 */
export function nextToStart(
  runs: RunSummary[],
  running: ReadonlySet<string>,
  concurrency: number,
): RunSummary[] {
  const free = concurrency - running.size
  if (free <= 0) return []
  return runs
    .filter((r) => r.status === 'queued' && !running.has(r.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, free)
}

/** How often the scheduler looks for work regardless of what React is doing. */
const PUMP_INTERVAL_MS = 2500

/** Trim a prompt into something that fits a list row. */
function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n').find((l) => l.trim())?.trim() ?? 'Untitled run'
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

export function useQueue({ dir, settings, onMutated, onRunFailed }: UseQueueOptions) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [queueSettings, setQueueSettings] = useState<QueueSettings>(loadQueueSettings)
  const [loaded, setLoaded] = useState(false)

  const dirRef = useRef(dir)
  dirRef.current = dir
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const queueSettingsRef = useRef(queueSettings)
  queueSettingsRef.current = queueSettings
  const onRunFailedRef = useRef(onRunFailed)
  onRunFailedRef.current = onRunFailed

  /** Runs executing right now, and how to stop them. */
  const active = useRef(new Map<string, AbortController>())
  // Read by the scheduler, which can run from a timer rather than a render.
  const runsRef = useRef(runs)
  runsRef.current = runs

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
      try {
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
      } catch (err) {
        // Tidying up after a dead tab is housekeeping. If it fails — a write
        // refused, a file half-written — the queue still has to work, so this
        // says so and carries on rather than leaving the hook half-started.
        console.error('[deckle] could not tidy the queue on load:', err)
      } finally {
        if (!cancelled) setLoaded(true)
      }
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

      // Claim the slot before the first await. The scheduler fires from a timer
      // as well as from a render, and two calls that both got as far as reading
      // the record before either claimed it would run the same job twice.
      const controller = new AbortController()
      active.current.set(id, controller)

      // Everything from here is inside try/finally, including reading the run
      // and the first write. It wasn't, and that was the bug behind "queued
      // jobs never run": a throw from any of those — a refused write, a
      // permission that lapsed on reload, a server that blinked — escaped as
      // an unhandled rejection with the slot still held, so every later pass
      // saw the run as already executing and skipped it. The job then sat at
      // "Waiting its turn" for the rest of the session with nothing to show
      // for it. A held slot must be released on every path out of here.
      let run: Run | null = null
      let wrote = 0
      // Did it actually get going? Not the same question as "what does the run
      // object say" — the status is set in memory a moment before the write
      // that makes it true, and a failure between the two must leave the job
      // queued rather than recorded as a run that failed.
      let started = false
      try {
        run = await readRun(d, id)
        if (!run) {
          // The index says this run exists and its record doesn't. Drop the row
          // rather than leaving something unstartable in the list.
          await deleteRun(d, id)
          await refresh()
          console.warn(`[deckle] queued run ${id} has no record; removed from the queue`)
          return
        }
        // Someone else got to it — another tab, or a pass that overlapped this
        // one. Only work that is actually waiting gets started.
        if (run.status !== 'queued') return

        run.status = 'running'
        run.startedAt = run.startedAt ?? Date.now()
        run.question = undefined
        run.pendingPreview = undefined
        run.error = undefined
        await saveRun(d, run)
        await refresh()
        started = true
        wrote = run.writes.length

        const ctx: RunContext = {
          dir: d,
          run,
          settings: settingsFor(run, settingsRef.current),
          inbox: queueSettingsRef.current.inbox,
          signal: controller.signal,
          onTurn: async () => {
            await saveRun(d, run as Run)
            await refresh()
          },
        }

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
        if (!run || !started) {
          // It never got going. Leave it queued so the next pass retries it —
          // a library that refused a write a moment ago may not refuse the
          // next one — but say so, because a job that silently declines to
          // start is the whole failure this code is here to prevent.
          console.error(`[deckle] could not start run ${id}:`, err)
          onRunFailedRef.current?.(
            run?.title ?? 'A queued job',
            `Couldn't start it: ${err.message}. It stays in the queue and will be tried again.`,
          )
          return
        }
        run.status = err.name === 'AbortError' ? 'cancelled' : 'failed'
        run.error = err.name === 'AbortError' ? undefined : err.message
        run.summary = err.name === 'AbortError' ? 'Cancelled.' : err.message
        run.finishedAt = Date.now()
      } finally {
        // The slot comes back no matter which way this ended.
        active.current.delete(id)
        if (run && started) {
          try {
            await saveRun(d, run)
            await refresh()
            if (run.status === 'failed' && run.error) {
              onRunFailedRef.current?.(run.title, run.error)
            }
            if (run.writes.length !== wrote) onMutated()
          } catch (err) {
            // Recording the outcome failed. The work itself may well have
            // happened, so this is worth saying out loud rather than swallowing.
            console.error(`[deckle] could not record the outcome of run ${id}:`, err)
          }
        }
      }
    },
    [onMutated, refresh],
  )

  // ---- The scheduler ----
  //
  // Start as many queued runs as the concurrency setting allows.
  //
  // Everything it needs is read through refs, so it can be called from
  // anywhere — a render, a timer, a hand — rather than only from an effect
  // whose dependencies happen to have changed. It is deliberately guarded on
  // almost nothing: a queued run that no one starts is the worst outcome this
  // module has, and it is worth a wasted call to avoid it.
  const pump = useCallback(() => {
    if (!dirRef.current) return
    // Deliberately not awaited: each execute() drives its own run to
    // completion, and the point of concurrency is that they overlap.
    for (const row of nextToStart(
      runsRef.current,
      new Set(active.current.keys()),
      queueSettingsRef.current.concurrency,
    )) {
      void execute(row.id)
    }
  }, [execute])

  // The fast path: something changed, so look for work. Covers queueing a job
  // and a run finishing and freeing its slot.
  useEffect(() => {
    if (!loaded) return
    pump()
  }, [runs, loaded, pump])

  // The safety net. The effect above depends on a render happening; this one
  // doesn't. Without it, one missed update — a write that never landed, a
  // state change React batched away — leaves a job sitting at "Waiting its
  // turn" for ever, which is indistinguishable from a queue that is broken.
  useEffect(() => {
    if (!dir) return
    const timer = setInterval(pump, PUMP_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [dir, pump])

  // ---- Commands ----
  const enqueue = useCallback(
    async (
      prompt: string,
      contextPath?: string,
      model?: { provider: Provider; model: string },
    ) => {
      const d = dirRef.current
      const text = prompt.trim()
      if (!d || !text) return null
      const pinned = model ?? {
        provider: settingsRef.current.provider,
        model: settingsRef.current.models[settingsRef.current.provider],
      }
      const run: Run = {
        id: newRunId(),
        title: titleFrom(text),
        prompt: text,
        status: 'queued',
        createdAt: Date.now(),
        contextPath,
        provider: pinned.provider,
        model: pinned.model,
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
        settings: settingsFor(run, settingsRef.current),
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
        // A re-run is the same job, so it goes to the same model unless the
        // user changes it — comparing two runs is only meaningful that way.
        provider: previous.provider,
        model: previous.model,
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

  /**
   * Point a run at a different model.
   *
   * Allowed until it starts, and again once it has stopped — so a run that
   * failed on a small local model can be resumed on a bigger one, which is the
   * moment people actually want to change it.
   */
  const setRunModel = useCallback(
    async (id: string, selection: { provider: Provider; model: string }) => {
      const d = dirRef.current
      if (!d) return
      const run = await readRun(d, id)
      if (!run || run.status === 'running') return
      run.provider = selection.provider
      run.model = selection.model
      await saveRun(d, run)
      await refresh()
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
    setRunModel,
    remove,
    open,
    refresh,
  }
}

export type QueueApi = ReturnType<typeof useQueue>
export type { Run, RunStatus, RunSummary }
