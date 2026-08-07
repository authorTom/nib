/** Human-friendly relative time, e.g. "just now", "5m ago", "3d ago". */
export function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

/** Filenames Deckle generated itself, which the user has not chosen: "Untitled 3". */
const GENERATED_TITLE = /^Untitled(?: \d+)?$/

/** Long enough for any real heading; short enough to stay a usable filename. */
const MAX_DERIVED_TITLE = 120

/** True when a note is still carrying the name Deckle gave it, not one the user chose. */
export function isGeneratedTitle(title: string): boolean {
  return GENERATED_TITLE.test(title.trim())
}

/**
 * The note's own first heading, as a filename.
 *
 * Deckle's first principle is that the files outlive the app, and a library full of
 * `Untitled 7.md` does not survive contact with another editor, a file manager,
 * or a backup. The convention among folder-based Markdown editors — the
 * compatibility target — is to name the file after the heading, so a note that
 * says `# Latency review` becomes `Latency review.md` here too. Returns null
 * when there is nothing safe to derive, in which case the generated name stands.
 */
export function deriveTitleFromMarkdown(markdown: string): string | null {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // Only the top-level heading, and only when it opens the note: a document
    // that starts with prose has decided not to have a title.
    const match = /^#\s+(.+)$/.exec(line)
    if (!match) return null
    const title = match[1]
      // Strip the marks a heading may carry; a filename wants the words.
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DERIVED_TITLE)
      .trim()
    if (!title || isGeneratedTitle(title)) return null
    return title
  }
  return null
}

/** Folder part of a note path ("" at the root), e.g. "Projects/idea.md" → "Projects". */
export function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}
