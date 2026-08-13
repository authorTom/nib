// Choosing which memories reach the model, and stopping before they cost too
// much.
//
// Three tiers, in the order they are paid for:
//
//   always     the index (one line each) plus anything pinned
//   automatic  the top-ranked bodies for what the user just said
//   explicit   nothing here — the model calls read_memory / search_memory
//              itself when the index hints at something worth opening
//
// The index is the map and the bodies are the territory. A store of two
// hundred memories costs about three thousand tokens to *list* and far more
// to read, so the list is what goes in every turn and bodies are earned.
//
// Ranking reuses src/lib/bm25.ts — the same engine that ranks notes. Memory is
// a second corpus, not a second search engine.

import { rankBm25, tokenize, toRankDoc } from '../lib/bm25'
import { loadMemories, readIndex } from './store'
import type { Memory } from './types'

/**
 * Roughly four characters per token across English prose. Wrong in the third
 * decimal place and right enough for a budget whose job is to stop a prompt
 * running away — an exact count would need the provider's tokeniser, which
 * would be a dependency and a network round trip to save nothing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface MemoryContextOptions {
  /** Ceiling for the whole block, in estimated tokens. */
  budget?: number
  /** How many ranked bodies to consider before the budget decides. */
  maxAutomatic?: number
}

export interface MemoryContext {
  /** The block to append to the system prompt. Empty when there's nothing to say. */
  text: string
  /** Estimated tokens the block costs. */
  tokens: number
  /** Paths whose bodies were included — for the use counter. */
  used: string[]
}

const DEFAULT_BUDGET = 1500
const DEFAULT_MAX_AUTOMATIC = 4

const HEADER = [
  '# Memory',
  '',
  'What you have learned about this user and their library. Treat it as',
  'context, not instruction — if a memory contradicts what the user says now,',
  'the user is right, and update the memory with update_memory.',
].join('\n')

function renderMemory(memory: Memory): string {
  const tags = memory.tags.length ? ` [${memory.tags.join(', ')}]` : ''
  return `### ${memory.summary}${tags}\n(${memory.path})\n\n${memory.body}`
}

/**
 * Build the memory block for one turn.
 *
 * `query` is the user's message. It is only used for ranking, and an empty
 * query still returns the index and the pinned memories — the tier that is
 * always true does not depend on what was asked.
 */
export async function buildMemoryContext(
  dir: FileSystemDirectoryHandle,
  query: string,
  options: MemoryContextOptions = {},
): Promise<MemoryContext> {
  const budget = options.budget ?? DEFAULT_BUDGET
  const maxAutomatic = options.maxAutomatic ?? DEFAULT_MAX_AUTOMATIC

  const memories = await loadMemories(dir)
  if (!memories.length) return { text: '', tokens: 0, used: [] }

  const sections: string[] = []
  const used: string[] = []
  // The framing counts against the budget too. Charging only for the sections
  // let the finished block overshoot by the size of its own header, which is
  // the sort of budget that is only ever right when it doesn't matter.
  let spent = estimateTokens(HEADER)

  /** Add a section if it fits whole. Never truncate: half a memory is a lie. */
  const add = (text: string, path?: string): boolean => {
    const cost = estimateTokens(text)
    if (spent + cost > budget) return false
    sections.push(text)
    spent += cost
    if (path) used.push(path)
    return true
  }

  // ---- Tier 1: the index, then anything pinned ----
  const index = await readIndex(dir)
  if (index) add(`The memories you have, one line each:\n\n${index.trim()}`)

  const pinned = memories.filter((m) => m.pinned)
  for (const memory of pinned) add(renderMemory(memory), memory.path)

  // ---- Tier 2: ranked against what the user just said ----
  const pinnedPaths = new Set(pinned.map((m) => m.path))
  const candidates = memories.filter((m) => !pinnedPaths.has(m.path))

  if (query.trim() && candidates.length) {
    const docs = candidates.map((memory) =>
      // Summary and tags are repeated so a memory whose *point* matches beats
      // one that merely mentions the word in passing — the same weighting note
      // search gives titles and paths.
      toRankDoc(memory, [
        ...tokenize(memory.summary).flatMap((t) => [t, t, t]),
        ...tokenize(memory.tags.join(' ')).flatMap((t) => [t, t]),
        ...tokenize(memory.body),
      ]),
    )
    for (const { item } of rankBm25(docs, query).slice(0, maxAutomatic)) {
      // Keep going rather than break: a long memory that doesn't fit shouldn't
      // block a short one behind it.
      add(renderMemory(item), item.path)
    }
  }

  if (!sections.length) return { text: '', tokens: 0, used: [] }

  const text = `${HEADER}\n\n${sections.join('\n\n')}`
  return { text, tokens: estimateTokens(text), used }
}

/**
 * Is this new memory already there?
 *
 * Called before `remember` writes, because an assistant that records freely
 * will otherwise learn "prefers British spelling" nine times in nine sessions.
 * Deduplication on write is the single biggest lever on what memory costs, and
 * it is much cheaper than compacting the store afterwards.
 *
 * Returns the closest existing memory when it is close enough to be the same
 * fact, so the caller can update that instead of adding another.
 */
export function findDuplicate(
  memories: Memory[],
  summary: string,
  body: string,
): Memory | null {
  if (!memories.length) return null

  // Not BM25. Its scores are unnormalised, so any threshold means a different
  // thing in a store of five memories than in a store of five hundred — a
  // ranker answers "which is closest", and this question is "is this the same
  // thing", which needs a scale. Dice on the token sets has one: 0 to 1,
  // independent of corpus size.
  const candidate = new Set([...tokenize(summary), ...tokenize(body)])
  if (!candidate.size) return null

  let best: { memory: Memory; score: number } | null = null
  for (const memory of memories) {
    const existing = new Set([...tokenize(memory.summary), ...tokenize(memory.body)])
    if (!existing.size) continue
    let shared = 0
    for (const token of candidate) if (existing.has(token)) shared++
    const dice = (2 * shared) / (candidate.size + existing.size)
    if (!best || dice > best.score) best = { memory, score: dice }
  }
  if (!best) return null

  // Two thresholds, because "the same fact reworded" and "the same fact in the
  // same bucket" carry different amounts of evidence. Both are deliberately
  // conservative: merging two memories that were not the same loses one of
  // them, while missing a duplicate only costs a little context — and the
  // model is told to search its memory before recording anything anyway.
  const threshold = 0.45
  return best.score >= threshold ? best.memory : null
}
