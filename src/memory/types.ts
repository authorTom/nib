/**
 * What the assistant has learned, as one Markdown file per fact.
 *
 * A memory's `path` is its identity — the file is the record, not a row in
 * something that also happens to write files. Move it in Finder and it is
 * still the same memory; the index rebuilds itself around it.
 */

/** Coarse buckets, used for the folder a memory lands in and for grouping. */
export type MemoryKind =
  | 'preference'
  | 'project'
  | 'person'
  | 'fact'
  | 'convention'

export const MEMORY_KINDS: MemoryKind[] = [
  'preference',
  'project',
  'person',
  'fact',
  'convention',
]

/** Folder each kind lives in, so the store is browsable without the app. */
export const KIND_FOLDER: Record<MemoryKind, string> = {
  preference: 'preferences',
  project: 'projects',
  person: 'people',
  fact: 'facts',
  convention: 'conventions',
}

export type Confidence = 'low' | 'medium' | 'high'

export interface Memory {
  /** Path within the memory folder, e.g. "preferences/british-spelling.md". */
  path: string
  kind: MemoryKind
  /** One line. This — and only this — is what the always-loaded index carries. */
  summary: string
  tags: string[]
  /** Always in context, budget permitting. For things that are true every turn. */
  pinned: boolean
  confidence: Confidence
  /** "YYYY-MM-DD", matching how the planner stores dates. */
  created: string
  updated: string
  /** Times this memory has been retrieved into a prompt. Drives review, not deletion. */
  uses: number
  /** The Markdown beneath the front matter. */
  body: string
}

/** What `remember` needs; everything else has a default. */
export interface MemoryDraft {
  summary: string
  body: string
  kind?: MemoryKind
  tags?: string[]
  pinned?: boolean
  confidence?: Confidence
}
