// Queue persistence: an index of rows, plus one file per run.
//
// Not a single JSON blob like tasks.json and bookmarks.json, because a run
// carries its whole transcript and those do not stay small. The shape here is
// the one `.history` already uses in this codebase — an index for listing, a
// file per record — so the panel can show fifty runs without loading fifty
// transcripts, which on a server library would be fifty HTTP requests.
//
// Everything lives in the library, so the queue travels with the notes and a
// server-side worker (later) reads exactly what the browser wrote.

import { dataSubdir, readDataJson, writeDataJson } from '../fs/appData'
import { EMPTY_INDEX, type Run, type RunIndex, type RunSummary } from './types'

const RUNS_DIR = 'runs'
const INDEX_FILE = 'runs/index.json'

/** Runs kept before the oldest finished ones are pruned. */
const MAX_RUNS = 200

let counter = 0
export function newRunId(): string {
  return `r${Date.now().toString(36)}${(counter++).toString(36)}`
}

function toSummary(run: Run): RunSummary {
  // Explicitly omitted rather than destructured away, so adding a field to Run
  // is a compile error here rather than a transcript quietly entering the index.
  const { messages, pendingCalls, pendingPreview, ...summary } = run
  void messages
  void pendingCalls
  void pendingPreview
  return summary
}

// ---- Index ------------------------------------------------------------------

export async function loadIndex(dir: FileSystemDirectoryHandle): Promise<RunIndex> {
  const parsed = (await readDataJson(dir, INDEX_FILE)) as RunIndex | null
  if (parsed?.version === 1 && Array.isArray(parsed.runs)) return parsed
  return EMPTY_INDEX
}

async function saveIndex(
  dir: FileSystemDirectoryHandle,
  index: RunIndex,
): Promise<void> {
  await writeDataJson(dir, INDEX_FILE, index)
}

// ---- Records ----------------------------------------------------------------

async function runsDir(
  dir: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  return await dataSubdir(dir, RUNS_DIR, create)
}

export async function readRun(
  dir: FileSystemDirectoryHandle,
  id: string,
): Promise<Run | null> {
  try {
    const folder = await runsDir(dir, false)
    const handle = await folder.getFileHandle(`${id}.json`)
    return JSON.parse(await (await handle.getFile()).text()) as Run
  } catch {
    return null
  }
}

/**
 * Write a run and update its row in the index.
 *
 * Called after every provider turn, so a tab that is closed mid-run loses one
 * turn rather than the whole transcript.
 */
export async function saveRun(
  dir: FileSystemDirectoryHandle,
  run: Run,
): Promise<void> {
  const folder = await runsDir(dir, true)
  const handle = await folder.getFileHandle(`${run.id}.json`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(run, null, 2))
  await writable.close()

  const index = await loadIndex(dir)
  const summary = toSummary(run)
  const at = index.runs.findIndex((r) => r.id === run.id)
  if (at === -1) index.runs.unshift(summary)
  else index.runs[at] = summary

  await saveIndex(dir, await prune(dir, index))
}

export async function deleteRun(
  dir: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  try {
    const folder = await runsDir(dir, false)
    await folder.removeEntry(`${id}.json`)
  } catch {
    // Already gone; still drop the row.
  }
  const index = await loadIndex(dir)
  index.runs = index.runs.filter((r) => r.id !== id)
  await saveIndex(dir, index)
}

/**
 * Keep the queue from growing without limit.
 *
 * Only finished runs are ever dropped, oldest first — anything queued, running
 * or waiting on a person stays regardless of age, because a run the user still
 * owes an answer to is not old, it is outstanding.
 */
async function prune(
  dir: FileSystemDirectoryHandle,
  index: RunIndex,
): Promise<RunIndex> {
  if (index.runs.length <= MAX_RUNS) return index
  const keep: RunSummary[] = []
  const drop: RunSummary[] = []
  // Newest first, so the tail is what goes.
  const ordered = [...index.runs].sort((a, b) => b.createdAt - a.createdAt)
  for (const row of ordered) {
    const finished = row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled'
    if (!finished || keep.length < MAX_RUNS) keep.push(row)
    else drop.push(row)
  }
  for (const row of drop) {
    try {
      const folder = await runsDir(dir, false)
      await folder.removeEntry(`${row.id}.json`)
    } catch {
      // Nothing to remove.
    }
  }
  return { ...index, runs: keep }
}
