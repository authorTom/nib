// A queue of assistant work, and one record per attempt at it.
//
// "Task" is taken — it means a to-do item everywhere else in this codebase
// (src/tasks/, the planner panel, .deckle/tasks.json, /api/v1/tasks). Queued
// assistant work is a **run**, and running it again makes another run.

import type { ActionPreview } from '../ai/tools'
import type { ChatMessage, Provider, ToolCall } from '../ai/types'

export type RunStatus =
  /** Waiting for a slot. */
  | 'queued'
  /** A provider call is in flight, or tools are executing. */
  | 'running'
  /** Wants to write outside the inbox. Parked until you approve or reject. */
  | 'needs-approval'
  /** Asked you a question. Parked until you answer. */
  | 'needs-input'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** Statuses that need a person before anything else can happen. */
export const WAITING: RunStatus[] = ['needs-approval', 'needs-input']

/** Statuses that are over, one way or another. */
export const FINISHED: RunStatus[] = ['succeeded', 'failed', 'cancelled']

/** A note the run created or changed, for the "what did it do" list. */
export interface RunWrite {
  path: string
  kind: 'create' | 'overwrite' | 'other'
  /** False while the write is still only proposed. */
  applied: boolean
}

/**
 * One attempt at a piece of queued work.
 *
 * `messages` is the same `ChatMessage[]` the chat panel builds in memory — a
 * run record is that array, written down. Resuming is therefore not a separate
 * mechanism: it is loading the transcript and carrying on.
 */
export interface Run {
  id: string
  /** Short label for the list, derived from the prompt when queued. */
  title: string
  prompt: string
  status: RunStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  /** The note that was open when this was queued, if any. */
  contextPath?: string

  /**
   * The model this run was queued against, pinned at that moment.
   *
   * Runs used to read whichever model the settings happened to hold when each
   * turn fired, so switching model in the chat panel silently re-pointed
   * everything still waiting, and a finished run could not say what produced
   * it. Both are recorded here instead. Optional because runs written before
   * this existed have neither, and those fall back to the current settings.
   */
  provider?: Provider
  model?: string

  messages: ChatMessage[]
  /**
   * Tool calls from the current turn that have not been executed yet. The head
   * is whatever the run is parked on; the rest are waiting behind it.
   *
   * A provider will reject a transcript whose assistant turn has three tool
   * calls and two results, so a run that stops mid-turn has to remember what
   * it still owes.
   */
  pendingCalls?: ToolCall[]
  /** Preview of `pendingCalls[0]` while parked on an approval. */
  pendingPreview?: ActionPreview
  /** What it asked, while parked on a question. */
  question?: string

  writes: RunWrite[]
  /** One line for the list: what it did, or why it stopped. */
  summary?: string
  error?: string
  /** The run this was re-run or resumed from. */
  parentRunId?: string
  attempt: number
}

/** The row form, held in one index file so the list loads without transcripts. */
export type RunSummary = Omit<Run, 'messages' | 'pendingCalls' | 'pendingPreview'>

export interface RunIndex {
  version: 1
  runs: RunSummary[]
}

export const EMPTY_INDEX: RunIndex = { version: 1, runs: [] }
