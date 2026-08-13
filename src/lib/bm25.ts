// BM25 ranking, over any corpus.
//
// Lifted out of src/ai/retrieval.ts when the assistant gained a memory: the
// library and the memory store are two corpora, not two search engines, and a
// second copy of this arithmetic would be a second place for it to drift.
//
// Callers own their own tokenisation, because weighting is corpus-specific —
// note search repeats title and path tokens so a match on a note's name
// outranks the same word buried in someone else's body, and memory does the
// same with its summary. Only the scoring is shared.

const BM25_K1 = 1.2
const BM25_B = 0.75

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'for',
  'with', 'my', 'me', 'i', 'this', 'that', 'be', 'are', 'was', 'were', 'what',
  'which', 'how', 'do', 'does', 'about', 'at', 'as', 'by', 'from', 'not',
])

export function tokenize(text: string): string[] {
  const all = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
  const filtered = all.filter((t) => !STOPWORDS.has(t))
  // If the query was nothing but stopwords, better to match them than nothing.
  return filtered.length ? filtered : all
}

/** A document reduced to term frequencies, ready to rank. */
export interface RankDoc<T> {
  item: T
  tf: Map<string, number>
  len: number
}

/** Turn a caller's already-weighted token list into a rankable document. */
export function toRankDoc<T>(item: T, tokens: string[]): RankDoc<T> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return { item, tf, len: tokens.length }
}

export interface Ranked<T> {
  item: T
  score: number
}

/** Score `docs` against `query`, best first. Documents scoring zero are dropped. */
export function rankBm25<T>(docs: RankDoc<T>[], query: string): Ranked<T>[] {
  const qTerms = [...new Set(tokenize(query))]
  if (!qTerms.length || !docs.length) return []
  const n = docs.length
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / n || 1

  // Document frequency per query term, counted once rather than inside the
  // per-document loop — the old shape was O(terms × docs²) on every search.
  const df = new Map<string, number>()
  for (const term of qTerms) {
    df.set(term, docs.reduce((s, d) => s + (d.tf.has(term) ? 1 : 0), 0))
  }

  return docs
    .map((doc) => {
      let score = 0
      for (const term of qTerms) {
        const tf = doc.tf.get(term) ?? 0
        if (!tf) continue
        const seen = df.get(term) ?? 0
        const idf = Math.log(1 + (n - seen + 0.5) / (seen + 0.5))
        score +=
          (idf * tf * (BM25_K1 + 1)) /
          (tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.len) / avgLen))
      }
      return { item: doc.item, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
}
