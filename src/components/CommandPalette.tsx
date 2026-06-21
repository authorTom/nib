import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { CornerDownLeft, FileText, Search, type LucideIcon } from 'lucide-react'
import type { NoteFile } from '../fs/vault'

export interface Command {
  id: string
  label: string
  hint?: string
  icon?: LucideIcon
  /** Section header to group under (defaults to "Commands"). */
  section?: string
  /** Extra terms to match against (synonyms). */
  keywords?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: Command[]
  notes: NoteFile[]
  onOpenNote: (id: string) => void
}

type Item =
  | { kind: 'command'; cmd: Command }
  | { kind: 'note'; note: NoteFile }

function folderOf(id: string): string {
  return id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''
}

export default function CommandPalette({
  open,
  onClose,
  commands,
  notes,
  onOpenNote,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset and focus whenever the palette opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const { items, commandCount } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const cmds = commands.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q) ||
        (c.keywords ?? '').toLowerCase().includes(q),
    )
    const ns = notes
      .filter(
        (n) =>
          !q ||
          n.title.toLowerCase().includes(q) ||
          folderOf(n.id).toLowerCase().includes(q),
      )
      .slice(0, 50)
    const list: Item[] = [
      ...cmds.map((cmd): Item => ({ kind: 'command', cmd })),
      ...ns.map((note): Item => ({ kind: 'note', note })),
    ]
    return { items: list, commandCount: cmds.length }
  }, [query, commands, notes])

  // Keep the selection in range as the filtered list changes.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)))
  }, [items.length])

  // Keep the selected row visible.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${index}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const run = (item: Item) => {
    onClose()
    if (item.kind === 'command') item.cmd.run()
    else onOpenNote(item.note.id)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (items.length ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[index]
      if (item) run(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search notes…"
            aria-label="Command palette"
          />
        </div>

        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">No results</div>}
          {items.map((item, i) => {
            const Icon =
              item.kind === 'command'
                ? item.cmd.icon ?? CornerDownLeft
                : FileText
            const key =
              item.kind === 'command' ? `c-${item.cmd.id}` : `n-${item.note.id}`
            const path = item.kind === 'note' ? folderOf(item.note.id) : ''

            // Section header: when a command's section changes, or at the
            // first note.
            let header: string | null = null
            if (item.kind === 'command') {
              const section = item.cmd.section ?? 'Commands'
              const prev = i > 0 ? items[i - 1] : null
              const prevSection =
                prev && prev.kind === 'command'
                  ? prev.cmd.section ?? 'Commands'
                  : null
              if (section !== prevSection) header = section
            } else if (i === commandCount) {
              header = 'Notes'
            }

            return (
              <Fragment key={key}>
                {header && <div className="palette-section">{header}</div>}
                <div
                  data-index={i}
                  className={`palette-item${i === index ? ' selected' : ''}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(item)}
                >
                  <Icon size={16} className="palette-item-icon" />
                  <span className="palette-item-label">
                    {item.kind === 'command' ? item.cmd.label : item.note.title}
                  </span>
                  {item.kind === 'command' && item.cmd.hint && (
                    <span className="palette-hint">{item.cmd.hint}</span>
                  )}
                  {item.kind === 'note' && path && (
                    <span className="palette-hint">{path}</span>
                  )}
                </div>
              </Fragment>
            )
          })}
        </div>

        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
