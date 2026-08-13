import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, FolderPlus, Library, Search } from 'lucide-react'
import type { TreeNode } from '../fs/library'

/**
 * Choosing a folder in the library, for anything that has to land somewhere.
 *
 * Shared by the move dialog and the import dialog on purpose: "where should
 * this go" is one question, and answering it in two different shapes is how a
 * library ends up with two sets of rules for the same thing. The whole tree is
 * listed rather than browsed one level at a time — a destination you can see is
 * quicker to pick than one you have to walk to — with a filter for libraries
 * too deep to scan.
 */

/** Characters a folder name can't hold — the library's own rule, applied here
 *  so a typed name is rejected before it reaches the filesystem. */
const ILLEGAL = /[\\/:*?"<>|]/g

/**
 * Turn typed text into a library-relative folder path.
 *
 * `/` is kept as a separator, so "Archive/2026" names a nested folder in one
 * go; everything else illegal is dropped. Returns "" when nothing usable is
 * left, which callers read as "not a folder".
 */
export function sanitizeFolderPath(raw: string): string {
  return raw
    .split('/')
    .map((segment) => segment.replace(ILLEGAL, '').replace(/^\.+/, '').trim())
    .filter(Boolean)
    .join('/')
}

export interface FolderOption {
  /** Library-relative path; "" is the library root. */
  path: string
  name: string
  depth: number
  /** Notes sitting directly in this folder. */
  notes: number
  /** Doesn't exist yet — writing here will create it. */
  isNew?: boolean
}

/** Every folder in the library, flattened in draw order, root first. */
function folderOptions(tree: TreeNode[], rootLabel: string): FolderOption[] {
  const out: FolderOption[] = [
    {
      path: '',
      name: rootLabel,
      depth: 0,
      notes: tree.filter((n) => n.kind === 'file').length,
    },
  ]
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue
      out.push({
        path: node.id,
        name: node.name,
        depth,
        notes: node.children.filter((c) => c.kind === 'file').length,
      })
      walk(node.children, depth + 1)
    }
  }
  walk(tree, 1)
  return out
}

interface FolderPickerProps {
  tree: TreeNode[]
  /** What the root is called — the library's own name reads better than "/". */
  rootLabel: string
  /** Currently chosen path ("" = root). */
  value: string
  onChange: (path: string) => void
  /** Where the thing already is, marked so a no-op move is obvious. */
  currentPath?: string
  /** Offer to name a folder that doesn't exist yet. */
  allowCreate?: boolean
  /** Enter on a row (or a double click) commits the choice. */
  onSubmit?: () => void
  /** Wording for the search box, e.g. "Search folders…". */
  placeholder?: string
}

export default function FolderPicker({
  tree,
  rootLabel,
  value,
  onChange,
  currentPath,
  allowCreate = true,
  onSubmit,
  placeholder = 'Search folders, or type a new one…',
}: FolderPickerProps) {
  const [query, setQuery] = useState('')
  /** A folder named here but not yet written — kept so it survives the filter. */
  const [pending, setPending] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const options = useMemo(() => folderOptions(tree, rootLabel), [tree, rootLabel])

  const typed = allowCreate ? sanitizeFolderPath(query) : ''
  const lower = query.trim().toLowerCase()

  const rows = useMemo(() => {
    const existing = options.filter(
      (o) => !lower || (o.path || rootLabel).toLowerCase().includes(lower),
    )
    const taken = new Set(options.map((o) => o.path.toLowerCase()))

    // A folder that was named but doesn't exist yet stays in the list while it
    // is the choice — clearing the filter must not silently reset it.
    const extra: FolderOption[] = []
    const add = (path: string) => {
      if (!path || taken.has(path.toLowerCase())) return
      if (extra.some((e) => e.path === path)) return
      extra.push({ path, name: path, depth: 0, notes: 0, isNew: true })
    }
    if (pending && pending !== typed) add(pending)
    add(typed)

    return [...existing, ...extra]
  }, [options, lower, rootLabel, typed, pending])

  const index = rows.findIndex((r) => r.path === value)

  // Keep the highlighted row in view when the arrows walk past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [value, rows.length])

  const choose = (option: FolderOption) => {
    if (option.isNew) setPending(option.path)
    onChange(option.path)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!rows.length) return
      const down = e.key === 'ArrowDown'
      // With the choice filtered out of view there is nothing to step from, so
      // the arrows enter the list from the end they came in at.
      const next =
        index === -1
          ? rows[down ? 0 : rows.length - 1]
          : rows[(index + (down ? 1 : -1) + rows.length) % rows.length]
      choose(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <div className="folder-picker" onKeyDown={onKeyDown}>
      <div className="folder-picker-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Search folders"
          autoFocus
        />
      </div>

      <div
        className="folder-picker-list"
        role="listbox"
        aria-label="Destination folder"
        ref={listRef}
      >
        {rows.length === 0 && (
          <div className="folder-picker-empty">No folder matches that.</div>
        )}

        {rows.map((option) => {
          const selected = option.path === value
          const isCurrent = currentPath !== undefined && option.path === currentPath
          return (
            <button
              key={option.path || '__root__'}
              type="button"
              role="option"
              aria-selected={selected}
              data-selected={selected}
              className={`folder-picker-row${selected ? ' selected' : ''}${
                option.isNew ? ' is-new' : ''
              }`}
              style={{ paddingLeft: 10 + (lower ? 0 : option.depth) * 14 }}
              onClick={() => choose(option)}
              onDoubleClick={() => {
                choose(option)
                onSubmit?.()
              }}
            >
              <span className="folder-picker-icon">
                {option.isNew ? (
                  <FolderPlus size={16} />
                ) : option.path ? (
                  <Folder size={16} />
                ) : (
                  <Library size={16} />
                )}
              </span>
              <span className="folder-picker-name">
                {option.isNew ? option.path : option.name}
              </span>
              {/* Under a filter the names alone are ambiguous, so each row
                  carries the path it actually means. */}
              {!!lower && !option.isNew && option.path && (
                <span className="folder-picker-path">{option.path}</span>
              )}
              <span className="folder-picker-meta">
                {option.isNew
                  ? 'new folder'
                  : isCurrent
                    ? 'current'
                    : option.notes
                      ? `${option.notes} note${option.notes === 1 ? '' : 's'}`
                      : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
