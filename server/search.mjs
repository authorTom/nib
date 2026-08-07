// BM25 ranking for GET /api/v1/search.
//
// The browser assistant has a richer retrieval layer (src/ai/retrieval.ts) that
// can fuse in embeddings, but embeddings need an API key and the key lives in
// the user's browser, never on the server. So the API offers the lexical half:
// BM25 over note titles, paths, and content — no key, no network, no config.
//
// The index is rebuilt whenever the library's contents change, detected by a
// cheap signature over every note's path and mtime, so repeated searches
// against an unchanged library cost nothing but the scoring pass.

const K1 = 1.2
const B = 0.75

/** Titles and paths are short and highly diagnostic; count them extra. */
const TITLE_WEIGHT = 3

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'for',
  'with', 'my', 'me', 'i', 'this', 'that', 'be', 'are', 'was', 'were', 'what',
  'which', 'how', 'do', 'does', 'about', 'at', 'as', 'by', 'from', 'not',
])

function tokenize(text) {
  const all = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
  const filtered = all.filter((t) => !STOPWORDS.has(t))
  // A query of nothing but stopwords should match them rather than nothing.
  return filtered.length ? filtered : all
}

function snippetAround(content, terms) {
  const lower = content.toLowerCase()
  let index = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (index === -1 || found < index)) index = found
  }
  if (index === -1) {
    return content.slice(0, 180).replace(/\s+/g, ' ').trim()
  }
  const start = Math.max(0, index - 60)
  const end = Math.min(content.length, index + 140)
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) snippet = `…${snippet}`
  if (end < content.length) snippet = `${snippet}…`
  return snippet
}

export function createSearch(library) {
  let cache = null // { signature, docs, df, avgLength }

  /** Flatten the tree the library API already builds into a list of note files. */
  function flatten(nodes, out = []) {
    for (const node of nodes) {
      if (node.kind === 'folder') flatten(node.children, out)
      else out.push(node)
    }
    return out
  }

  async function buildIndex() {
    const files = flatten(await library.tree(''))
    const signature = files.map((f) => `${f.id}:${f.updatedAt}`).join('|')
    if (cache && cache.signature === signature) return cache

    const docs = []
    const df = new Map()
    let totalLength = 0

    for (const file of files) {
      let content = ''
      try {
        content = await library.readText(file.id)
      } catch {
        // Disappeared between the walk and the read — skip it.
        continue
      }

      const titleTokens = tokenize(`${file.title} ${file.id.replace(/\//g, ' ')}`)
      const tokens = [
        ...Array.from({ length: TITLE_WEIGHT }, () => titleTokens).flat(),
        ...tokenize(content),
      ]

      const tf = new Map()
      for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
      for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1)

      docs.push({ file, content, tf, length: tokens.length })
      totalLength += tokens.length
    }

    cache = {
      signature,
      docs,
      df,
      avgLength: docs.length ? totalLength / docs.length : 1,
    }
    return cache
  }

  /**
   * Rank notes against `query`. `folder` restricts the search to one subtree.
   * Returns `{ path, title, folder, score, snippet, updatedAt }` objects.
   */
  async function search(query, { limit = 10, folder = '' } = {}) {
    const terms = tokenize(query)
    if (!terms.length) return []

    const index = await buildIndex()
    const total = index.docs.length || 1
    const scored = []

    for (const doc of index.docs) {
      if (folder && !doc.file.id.startsWith(`${folder}/`)) continue

      let score = 0
      for (const term of terms) {
        const tf = doc.tf.get(term)
        if (!tf) continue
        const df = index.df.get(term) ?? 0
        // BM25's idf, in the form that stays positive for common terms.
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
        const norm = 1 - B + (B * doc.length) / index.avgLength
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * norm))
      }
      if (score <= 0) continue

      scored.push({
        path: doc.file.id,
        title: doc.file.title,
        folder: doc.file.id.includes('/')
          ? doc.file.id.slice(0, doc.file.id.lastIndexOf('/'))
          : '',
        score: Number(score.toFixed(4)),
        snippet: snippetAround(doc.content, terms),
        updatedAt: doc.file.updatedAt,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }

  return { search }
}
