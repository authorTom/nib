/**
 * A line diff, sized for the assistant's approval card.
 *
 * The card exists so that "every AI edit is shown as a diff you approve first"
 * is true, not decorative. Showing the whole new file — which is what the card
 * used to do — asks the reader to spot the difference between three thousand
 * words and three thousand words. This produces the changed lines and enough
 * context to place them, which is a thing a person can actually check before
 * clicking Approve.
 *
 * No dependency: the container's server ships with none, and a line LCS is
 * forty lines of code.
 */

export type DiffLineKind = 'add' | 'remove' | 'context'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 1-based line number in the old file; null for added lines. */
  before: number | null
  /** 1-based line number in the new file; null for removed lines. */
  after: number | null
}

export interface DiffHunk {
  /** How many unchanged lines were collapsed away above this hunk. */
  skipped: number
  lines: DiffLine[]
}

export interface FileDiff {
  hunks: DiffHunk[]
  added: number
  removed: number
  /** The two versions are identical. */
  identical: boolean
  /**
   * The change was too large to align line by line, so it is reported as one
   * replaced block rather than a misleadingly precise diff.
   */
  coarse: boolean
}

/** Unchanged lines kept either side of a change, to place it in the file. */
const CONTEXT = 3

/**
 * Above this many cells the LCS table costs more than the answer is worth. A
 * 1000x1000 middle section is already an edit no one is reading line by line.
 */
const MAX_LCS_CELLS = 1_000_000

function splitLines(text: string): string[] {
  if (text === '') return []
  // A trailing newline is a line terminator, not an empty last line.
  return text.replace(/\n$/, '').split('\n')
}

/** Longest common subsequence of two line arrays, as a list of index pairs. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  // table[i][j] = LCS length of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * Diff two versions of a note.
 *
 * Common prefix and suffix are trimmed before any alignment work, which is
 * what makes this cheap in the case that actually happens: an assistant
 * rewriting one paragraph of a long document leaves a tiny middle to align.
 */
export function diffLines(before: string, after: string): FileDiff {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)

  if (before === after) {
    return { hunks: [], added: 0, removed: 0, identical: true, coarse: false }
  }

  // Trim the matching head and tail.
  let head = 0
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  ) {
    head++
  }
  let tail = 0
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail++
  }

  const oldMid = oldLines.slice(head, oldLines.length - tail)
  const newMid = newLines.slice(head, newLines.length - tail)

  const coarse = oldMid.length * newMid.length > MAX_LCS_CELLS

  // Walk the middle into a flat line list, then group it into hunks.
  const flat: DiffLine[] = []
  const pushContext = (index: number) => {
    flat.push({
      kind: 'context',
      text: oldLines[index],
      before: index + 1,
      after: index + 1,
    })
  }

  for (let i = 0; i < head; i++) pushContext(i)

  let added = 0
  let removed = 0

  if (coarse) {
    // Too big to align: state it as a wholesale replacement rather than
    // inventing line-level precision the reader would trust.
    oldMid.forEach((text, k) => {
      flat.push({ kind: 'remove', text, before: head + k + 1, after: null })
      removed++
    })
    newMid.forEach((text, k) => {
      flat.push({ kind: 'add', text, before: null, after: head + k + 1 })
      added++
    })
  } else {
    const pairs = lcsPairs(oldMid, newMid)
    let oi = 0
    let ni = 0
    const emitUpTo = (untilOld: number, untilNew: number) => {
      while (oi < untilOld) {
        flat.push({
          kind: 'remove',
          text: oldMid[oi],
          before: head + oi + 1,
          after: null,
        })
        removed++
        oi++
      }
      while (ni < untilNew) {
        flat.push({
          kind: 'add',
          text: newMid[ni],
          before: null,
          after: head + ni + 1,
        })
        added++
        ni++
      }
    }
    for (const [po, pn] of pairs) {
      emitUpTo(po, pn)
      flat.push({
        kind: 'context',
        text: oldMid[po],
        before: head + po + 1,
        after: head + pn + 1,
      })
      oi = po + 1
      ni = pn + 1
    }
    emitUpTo(oldMid.length, newMid.length)
  }

  for (let t = tail; t > 0; t--) {
    const oldIndex = oldLines.length - t
    const newIndex = newLines.length - t
    flat.push({
      kind: 'context',
      text: oldLines[oldIndex],
      before: oldIndex + 1,
      after: newIndex + 1,
    })
  }

  // The strings can still differ with nothing to show — a changed trailing
  // newline is the usual case. Report that as no change rather than rendering
  // a "+0 −0" header above an empty box.
  return {
    hunks: added || removed ? groupHunks(flat) : [],
    added,
    removed,
    identical: added === 0 && removed === 0,
    coarse,
  }
}

/** Collapse long runs of unchanged lines, keeping CONTEXT either side. */
function groupHunks(flat: DiffLine[]): DiffHunk[] {
  const keep = new Array<boolean>(flat.length).fill(false)
  flat.forEach((line, i) => {
    if (line.kind === 'context') return
    for (
      let k = Math.max(0, i - CONTEXT);
      k <= Math.min(flat.length - 1, i + CONTEXT);
      k++
    ) {
      keep[k] = true
    }
  })

  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let skipped = 0
  flat.forEach((line, i) => {
    if (!keep[i]) {
      skipped++
      current = null
      return
    }
    if (!current) {
      current = { skipped, lines: [] }
      hunks.push(current)
      skipped = 0
    }
    current.lines.push(line)
  })
  return hunks
}
