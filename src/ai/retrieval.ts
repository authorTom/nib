// Library retrieval for the AI assistant's search_notes tool.
//
// Two layers, fused with reciprocal-rank fusion:
//   • Lexical — a BM25 index over note titles, paths, and content. Built
//     in-memory on demand, no network, works with every provider.
//   • Semantic (optional) — note embeddings via the provider's OpenAI-
//     compatible /embeddings endpoint (OpenAI or LM Studio), cached in
//     IndexedDB keyed by note mtime so only changed notes are re-embedded.
//     Enabled from assistant settings; any failure falls back to lexical.

import type { NoteFile } from '../fs/library'
import * as library from '../fs/library'
import type { AssistantSettings } from './types'

export interface RetrievedNote {
  id: string
  snippet: string
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'for',
  'with', 'my', 'me', 'i', 'this', 'that', 'be', 'are', 'was', 'were', 'what',
  'which', 'how', 'do', 'does', 'about', 'at', 'as', 'by', 'from', 'not',
])

function tokenize(text: string): string[] {
  const all = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
  const filtered = all.filter((t) => !STOPWORDS.has(t))
  // If the query was nothing but stopwords, better to match them than nothing.
  return filtered.length ? filtered : all
}

// ---- Content cache ----------------------------------------------------------

const contentCache = new Map<string, string>() // `${id}::${mtime}` → text
const CONTENT_CACHE_MAX = 500

async function readContent(
  dir: FileSystemDirectoryHandle,
  file: NoteFile,
): Promise<string> {
  const key = `${file.id}::${file.updatedAt}`
  const hit = contentCache.get(key)
  if (hit !== undefined) return hit
  let text = ''
  try {
    text = await library.readNote(dir, file.id)
  } catch {
    text = ''
  }
  contentCache.set(key, text)
  while (contentCache.size > CONTENT_CACHE_MAX) {
    const oldest = contentCache.keys().next().value
    if (oldest === undefined) break
    contentCache.delete(oldest)
  }
  return text
}

// ---- Lexical (BM25) ---------------------------------------------------------

interface Doc {
  file: NoteFile
  text: string
  tf: Map<string, number>
  len: number
}

const BM25_K1 = 1.2
const BM25_B = 0.75

function buildDocs(files: NoteFile[], texts: string[]): Doc[] {
  return files.map((file, i) => {
    // Title and path tokens are weighted by repetition — a match on the
    // note's name should outrank the same match buried in another note's body.
    const tokens = [
      ...tokenize(file.id).flatMap((t) => [t, t, t]),
      ...tokenize(texts[i]),
    ]
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { file, text: texts[i], tf, len: tokens.length }
  })
}

function bm25Rank(docs: Doc[], query: string): Doc[] {
  const qTerms = [...new Set(tokenize(query))]
  if (!qTerms.length || !docs.length) return []
  const n = docs.length
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / n || 1

  const scored = docs.map((doc) => {
    let score = 0
    for (const term of qTerms) {
      const tf = doc.tf.get(term) ?? 0
      if (!tf) continue
      const df = docs.reduce((s, d) => s + (d.tf.has(term) ? 1 : 0), 0)
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      score +=
        (idf * tf * (BM25_K1 + 1)) /
        (tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.len) / avgLen))
    }
    return { doc, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.doc)
}

// ---- Semantic (embeddings) --------------------------------------------------

// Pre-rename database name, kept so the cache survives: renaming it would throw
// away every embedding and re-embed the whole library at the user's expense.
const EMB_DB = 'notes-vault-index'
const EMB_STORE = 'embeddings'
const EMB_BATCH = 32
const EMB_MAX_CHARS = 8000

interface StoredEmbedding {
  mtime: number
  model: string
  vector: number[]
}

function embeddingsEnabled(settings: AssistantSettings): boolean {
  if (!settings.semanticSearch) return false
  if (settings.provider === 'openai') return !!settings.openaiKey
  if (settings.provider === 'lmstudio') return !!settings.embeddingModel
  return false
}

function openEmbDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EMB_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(EMB_STORE)) {
        req.result.createObjectStore(EMB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

async function loadEmbeddings(
  ids: string[],
): Promise<Map<string, StoredEmbedding>> {
  const db = await openEmbDb()
  try {
    return await new Promise((resolve, reject) => {
      const out = new Map<string, StoredEmbedding>()
      const tx = db.transaction(EMB_STORE, 'readonly')
      const store = tx.objectStore(EMB_STORE)
      for (const id of ids) {
        const req = store.get(id)
        req.onsuccess = () => {
          if (req.result) out.set(id, req.result as StoredEmbedding)
        }
      }
      tx.oncomplete = () => resolve(out)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function saveEmbeddings(
  entries: { id: string; value: StoredEmbedding }[],
): Promise<void> {
  if (!entries.length) return
  const db = await openEmbDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EMB_STORE, 'readwrite')
      const store = tx.objectStore(EMB_STORE)
      for (const e of entries) store.put(e.value, e.id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Call the provider's OpenAI-compatible /embeddings endpoint. */
async function embedTexts(
  settings: AssistantSettings,
  texts: string[],
): Promise<number[][]> {
  const isOpenAI = settings.provider === 'openai'
  const baseUrl = isOpenAI
    ? 'https://api.openai.com/v1'
    : settings.lmstudioUrl || 'http://localhost:1234/v1'
  const model =
    settings.embeddingModel || (isOpenAI ? 'text-embedding-3-small' : '')
  if (!model) throw new Error('No embedding model configured')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isOpenAI) headers.Authorization = `Bearer ${settings.openaiKey}`

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: texts.map((t) => t.slice(0, EMB_MAX_CHARS)),
    }),
  })
  if (!resp.ok) {
    throw new Error(`Embeddings request failed (${resp.status})`)
  }
  const data = await resp.json()
  const rows = [...(data.data ?? [])].sort(
    (a: { index: number }, b: { index: number }) => a.index - b.index,
  )
  if (rows.length !== texts.length) throw new Error('Embeddings response mismatch')
  return rows.map((r: { embedding: number[] }) => r.embedding)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom ? dot / denom : 0
}

/** Embed any notes whose stored vector is missing or stale, then rank all
 *  notes against the query. Returns null when semantic search is unavailable. */
async function semanticRank(
  docs: Doc[],
  settings: AssistantSettings,
  query: string,
): Promise<NoteFile[] | null> {
  try {
    const model =
      settings.embeddingModel ||
      (settings.provider === 'openai' ? 'text-embedding-3-small' : '')
    const stored = await loadEmbeddings(docs.map((d) => d.file.id))

    const stale = docs.filter((d) => {
      const s = stored.get(d.file.id)
      return !s || s.mtime !== d.file.updatedAt || s.model !== model
    })
    for (let i = 0; i < stale.length; i += EMB_BATCH) {
      const batch = stale.slice(i, i + EMB_BATCH)
      const vectors = await embedTexts(
        settings,
        batch.map((d) => `${d.file.title}\n\n${d.text}`),
      )
      const entries = batch.map((d, j) => ({
        id: d.file.id,
        value: { mtime: d.file.updatedAt, model, vector: vectors[j] },
      }))
      await saveEmbeddings(entries)
      for (const e of entries) stored.set(e.id, e.value)
    }

    const [qv] = await embedTexts(settings, [query])
    return docs
      .map((d) => ({
        file: d.file,
        score: cosine(qv, stored.get(d.file.id)?.vector ?? []),
      }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.file)
  } catch {
    // Any failure (endpoint missing, model not loaded, network) → lexical only.
    return null
  }
}

// ---- Fusion + snippets ------------------------------------------------------

const RRF_K = 60

function makeSnippet(text: string, query: string): string {
  const lower = text.toLowerCase()
  let idx = -1
  let matchLen = 0
  for (const term of tokenize(query)) {
    const i = lower.indexOf(term)
    if (i >= 0 && (idx === -1 || i < idx)) {
      idx = i
      matchLen = term.length
    }
  }
  if (idx === -1) {
    idx = 0
    matchLen = 0
  }
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + matchLen + 120)
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`
  return snippet
}

/**
 * Search the library for the notes most relevant to `query`.
 * Lexical BM25 always runs; embeddings are fused in when enabled + available.
 */
export async function searchLibrary(
  dir: FileSystemDirectoryHandle,
  files: NoteFile[],
  query: string,
  settings?: AssistantSettings,
  k = 6,
): Promise<RetrievedNote[]> {
  if (!files.length) return []
  const texts: string[] = []
  for (const file of files) texts.push(await readContent(dir, file))
  const docs = buildDocs(files, texts)

  const lexical = bm25Rank(docs, query).slice(0, 30)
  const semantic =
    settings && embeddingsEnabled(settings)
      ? await semanticRank(docs, settings, query)
      : null

  // Reciprocal-rank fusion across whichever rankings we have.
  const fused = new Map<string, number>()
  const addRanking = (ranked: { id: string }[]) => {
    ranked.forEach((item, rank) => {
      fused.set(item.id, (fused.get(item.id) ?? 0) + 1 / (RRF_K + rank))
    })
  }
  addRanking(lexical.map((d) => ({ id: d.file.id })))
  if (semantic) addRanking(semantic.slice(0, 30).map((f) => ({ id: f.id })))

  const textById = new Map(docs.map((d) => [d.file.id, d.text]))
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => ({ id, snippet: makeSnippet(textById.get(id) ?? '', query) }))
}
