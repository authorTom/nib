// A deliberately small YAML front-matter reader and writer.
//
// Only what a memory file needs: a flat block of `key: value` at the top,
// where a value is a string, a number, a boolean, or a bracketed list of
// strings. No nesting, no anchors, no multi-line scalars — a real YAML parser
// would be a dependency, and the server is not allowed one, so this side does
// not get to grow one either.
//
// Front matter is safe here and nowhere else in Deckle: these files live in
// `.deckle/memory/` and are never opened by the editor, which would render the
// fence as visible text at the top of a note. Generated notes in the library
// proper carry their provenance in a footer line instead.
//
// Reading is forgiving because these files are meant to be hand-editable:
// anything unparseable is skipped rather than thrown, so one bad line cannot
// cost the user a memory.

export type FrontmatterValue = string | number | boolean | string[]

export interface Parsed {
  data: Record<string, FrontmatterValue>
  body: string
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseValue(raw: string): FrontmatterValue | undefined {
  const value = raw.trim()
  if (!value) return ''
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.replace(/^"|"$/g, '')
    }
  }
  if (value.startsWith('[')) {
    return value
      .slice(1, value.endsWith(']') ? -1 : undefined)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

/** Split a document into its front matter and the Markdown beneath it. */
export function parseFrontmatter(text: string): Parsed {
  const match = FENCE.exec(text)
  if (!match) return { data: {}, body: text.trim() }

  const data: Record<string, FrontmatterValue> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = parseValue(trimmed.slice(colon + 1))
    if (key && value !== undefined) data[key] = value
  }
  return { data, body: text.slice(match[0].length).trim() }
}

/** Quote only where a bare value would parse back as something else. */
function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  if (typeof value !== 'string') return String(value)
  const needsQuotes =
    value === '' ||
    value !== value.trim() ||
    /^[[\]{}"'#&*!|>%@`-]/.test(value) ||
    value.includes(': ') ||
    value.includes('\n') ||
    /^(true|false|-?\d+(\.\d+)?)$/.test(value)
  return needsQuotes ? JSON.stringify(value) : value
}

/** Write a document with front matter. Key order is the caller's. */
export function withFrontmatter(
  data: Record<string, FrontmatterValue>,
  body: string,
): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${serializeValue(v)}`)
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`
}
