import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import {
  Bookmark,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  ListTodo,
  Package,
  Pencil,
  Plus,
  Search,
  Trash,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import OverflowMenu, { type MenuItem } from './OverflowMenu'
import type { TreeNode } from '../fs/library'
import type { SearchResult } from '../hooks/useNotes'
import { dragHasFiles } from '../lib/importMarkdown'
import { rectOf, type FlightOrigin } from '../lib/motion'

interface SidebarProps {
  tree: TreeNode[]
  activeId: string | null
  open: boolean
  libraryName: string | null
  query: string
  searchResults: SearchResult[] | null
  onQueryChange: (q: string) => void
  /** `origin` is the row's rect, which the incoming note's title flies from. */
  onSelect: (id: string, origin: FlightOrigin | null) => void
  /** Just-created note, whose row shows as still-wet ink. */
  justCreatedId: string | null
  /** Just-restored note. Same wet ink: it was placed on the page. */
  justPlacedId: string | null
  onCreate: () => void
  onCreateInFolder: (folderPath: string) => void
  /** Create a folder with a name the user typed inline. */
  onCreateFolder: (parentPath: string, name: string) => void
  onDeleteFolder: (folderPath: string) => void
  onRenameFolder: (folderPath: string, newName: string) => void
  onRenameNote: (id: string, newTitle: string) => void
  onMoveNote: (id: string, targetFolderPath: string) => void
  onDelete: (id: string) => void
  onSwitchLibrary: () => void
  onOpenTrash: () => void
  onOpenTasks: () => void
  onOpenBookmarks: () => void
  /** Open the file picker (App owns the inputs, so the palette can use them too). */
  onOpenImport: () => void
  onOpenFolderImport: () => void
  /** A drop carrying files or folders, destined for `targetFolder`. */
  onDropFiles: (transfer: DataTransfer, targetFolder: string) => void
  onOpenExport: () => void
}

const ROOT = '__root__'
/** How long consecutive keystrokes count as one type-ahead search. */
const TYPEAHEAD_MS = 700

/** A row as actually drawn: the tree flattened down to what's currently visible. */
interface Row {
  id: string
  kind: 'folder' | 'file'
  /** Folder name, or note title. */
  label: string
  depth: number
}

/** Folder ids that are ancestors of a note path, e.g. "a/b/n.md" → ["a","a/b"]. */
function ancestorFolderIds(id: string): string[] {
  const parts = id.split('/')
  parts.pop() // drop the file name
  const result: string[] = []
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    result.push(acc)
  }
  return result
}

function parentOf(id: string): string {
  return id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''
}

/**
 * Inline text field used for both renaming a row and naming a new folder.
 *
 * Declared at module scope on purpose: nested inside Sidebar it would be a new
 * component type on every render, so React would remount it — and a half-typed
 * name would vanish the moment anything else in the sidebar changed.
 */
function NameInput({
  defaultValue,
  depth,
  onCommit,
  onCancel,
  label,
}: {
  defaultValue: string
  depth: number
  onCommit: (value: string) => void
  onCancel: () => void
  label: string
}) {
  return (
    <div className="tree-row tree-row-editing" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="tree-chevron" />
      <input
        className="tree-input"
        defaultValue={defaultValue}
        aria-label={label}
        autoFocus
        onFocus={(e) => e.target.select()}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit((e.target as HTMLInputElement).value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
    </div>
  )
}

export default function Sidebar({
  tree,
  activeId,
  open,
  libraryName,
  query,
  searchResults,
  onQueryChange,
  onSelect,
  justCreatedId,
  justPlacedId,
  onCreate,
  onCreateInFolder,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onRenameNote,
  onMoveNote,
  onDelete,
  onSwitchLibrary,
  onOpenTrash,
  onOpenTasks,
  onOpenBookmarks,
  onOpenImport,
  onOpenFolderImport,
  onDropFiles,
  onOpenExport,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** Row currently being renamed in place. */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** Parent folder awaiting a name for a new subfolder ("" = library root). */
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  /** Roving tabindex: the one row that's reachable with Tab. */
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ buffer: '', at: 0 })

  // Auto-expand the folders leading to the active note.
  useEffect(() => {
    if (!activeId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of ancestorFolderIds(activeId)) next.add(id)
      return next
    })
  }, [activeId])

  const toggle = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [],
  )

  const expand = useCallback(
    (id: string) => setExpanded((prev) => new Set(prev).add(id)),
    [],
  )

  /** Visible rows, in draw order — the basis for all keyboard movement. */
  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          out.push({ id: node.id, kind: 'folder', label: node.name, depth })
          if (expanded.has(node.id)) walk(node.children, depth + 1)
        } else {
          out.push({ id: node.id, kind: 'file', label: node.title, depth })
        }
      }
    }
    walk(tree, 0)
    return out
  }, [tree, expanded])

  const focusRow = useCallback((id: string) => {
    setFocusedId(id)
    requestAnimationFrame(() => {
      treeRef.current
        ?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
        ?.focus()
    })
  }, [])

  // Keep the roving tabstop pointing at something that still exists.
  useEffect(() => {
    if (focusedId && rows.some((r) => r.id === focusedId)) return
    setFocusedId(activeId ?? rows[0]?.id ?? null)
  }, [rows, focusedId, activeId])

  const startCreateFolder = useCallback(
    (parentPath: string) => {
      if (parentPath) expand(parentPath)
      setCreatingIn(parentPath)
    },
    [expand],
  )

  const commitCreateFolder = useCallback(
    (name: string) => {
      const parent = creatingIn
      setCreatingIn(null)
      const trimmed = name.trim()
      if (parent === null || !trimmed) return
      onCreateFolder(parent, trimmed)
    },
    [creatingIn, onCreateFolder],
  )

  const commitRename = useCallback(
    (row: Row, name: string) => {
      setRenaming(null)
      const trimmed = name.trim()
      if (!trimmed || trimmed === row.label) return
      if (row.kind === 'folder') onRenameFolder(row.id, trimmed)
      else onRenameNote(row.id, trimmed)
    },
    [onRenameFolder, onRenameNote],
  )

  /** A drop is either a note being dragged within the tree, or files from
   *  outside the browser — the same target folder receives both. */
  const handleDrop = (e: DragEvent, targetFolderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverId(null)
    setDraggingId(null)

    if (dragHasFiles(e.dataTransfer)) {
      onDropFiles(e.dataTransfer, targetFolderPath)
      if (targetFolderPath) expand(targetFolderPath)
      return
    }

    // A tab being dragged along the strip isn't a request to move the file.
    if (e.dataTransfer.types.includes('application/x-deckle-tab')) return

    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    onMoveNote(id, targetFolderPath)
    if (targetFolderPath) expand(targetFolderPath)
  }

  const onTreeKeyDown = (e: KeyboardEvent, row: Row) => {
    const index = rows.findIndex((r) => r.id === row.id)
    const move = (to: number) => {
      const next = rows[Math.max(0, Math.min(to, rows.length - 1))]
      if (next) focusRow(next.id)
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(index + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        move(index - 1)
        return
      case 'Home':
        e.preventDefault()
        move(0)
        return
      case 'End':
        e.preventDefault()
        move(rows.length - 1)
        return
      case 'ArrowRight':
        e.preventDefault()
        // Open a closed folder; step into an open one.
        if (row.kind === 'folder' && !expanded.has(row.id)) expand(row.id)
        else move(index + 1)
        return
      case 'ArrowLeft': {
        e.preventDefault()
        if (row.kind === 'folder' && expanded.has(row.id)) {
          toggle(row.id)
          return
        }
        const parent = parentOf(row.id)
        if (parent) focusRow(parent)
        return
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (row.kind === 'folder') toggle(row.id)
        else
          onSelect(
            row.id,
            rectOf((e.currentTarget as HTMLElement).querySelector('.tree-label')),
          )
        return
      case 'F2':
        e.preventDefault()
        setRenaming(row.id)
        return
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        if (row.kind === 'folder') onDeleteFolder(row.id)
        else onDelete(row.id)
        return
    }

    // Type-ahead: jump to the next row starting with what's been typed.
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
    const now = Date.now()
    const ta = typeahead.current
    ta.buffer = now - ta.at > TYPEAHEAD_MS ? e.key : ta.buffer + e.key
    ta.at = now
    const needle = ta.buffer.toLowerCase()
    const ordered = [...rows.slice(index + 1), ...rows.slice(0, index + 1)]
    const hit = ordered.find((r) => r.label.toLowerCase().startsWith(needle))
    if (hit) {
      e.preventDefault()
      focusRow(hit.id)
    }
  }

  const renderRow = (row: Row) => {
    const indent = { paddingLeft: 8 + row.depth * 14 }
    const isFolder = row.kind === 'folder'
    const isOpen = isFolder && expanded.has(row.id)

    if (renaming === row.id) {
      return (
        <NameInput
          key={`edit-${row.id}`}
          defaultValue={row.label}
          depth={row.depth}
          label={isFolder ? 'Folder name' : 'Note title'}
          onCommit={(value) => commitRename(row, value)}
          onCancel={() => setRenaming(null)}
        />
      )
    }

    return (
      <Fragment key={row.id}>
        <div
          data-row-id={row.id}
          role="treeitem"
          tabIndex={focusedId === row.id ? 0 : -1}
          aria-expanded={isFolder ? isOpen : undefined}
          aria-selected={row.id === activeId}
          aria-level={row.depth + 1}
          draggable={!isFolder}
          style={indent}
          className={[
            'tree-row',
            isFolder ? 'folder-row' : 'file-row',
            row.id === activeId ? 'active' : '',
            dragOverId === row.id ? 'drop-target' : '',
            draggingId === row.id ? 'dragging' : '',
            row.id === justCreatedId || row.id === justPlacedId ? 'wet' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={(e) =>
            isFolder
              ? toggle(row.id)
              : onSelect(row.id, rectOf(e.currentTarget.querySelector('.tree-label')))
          }
          onDoubleClick={() => setRenaming(row.id)}
          onFocus={() => setFocusedId(row.id)}
          onKeyDown={(e) => onTreeKeyDown(e, row)}
          onDragStart={
            isFolder
              ? undefined
              : (e) => {
                  e.dataTransfer.setData('text/plain', row.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDraggingId(row.id)
                }
          }
          onDragEnd={() => {
            setDragOverId(null)
            setDraggingId(null)
          }}
          onDragOver={
            isFolder
              ? (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOverId(row.id)
                }
              : undefined
          }
          onDragLeave={
            isFolder
              ? () => setDragOverId((cur) => (cur === row.id ? null : cur))
              : undefined
          }
          onDrop={isFolder ? (e) => handleDrop(e, row.id) : undefined}
        >
          <span className="tree-chevron">
            {isFolder && <ChevronRight size={15} className="chevron-icon" />}
          </span>
          <span className="tree-icon">
            {isFolder ? (
              isOpen ? (
                <FolderOpen size={16} />
              ) : (
                <Folder size={16} />
              )
            ) : (
              <FileText size={15} />
            )}
          </span>
          <span className="tree-label">{row.label}</span>

          <span className="tree-actions">
            {isFolder && (
              <>
                <button
                  type="button"
                  className="tree-action"
                  tabIndex={-1}
                  title="New subfolder"
                  aria-label={`New subfolder in ${row.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    startCreateFolder(row.id)
                  }}
                >
                  <FolderPlus size={15} />
                </button>
                <button
                  type="button"
                  className="tree-action"
                  tabIndex={-1}
                  title="New note in this folder"
                  aria-label={`New note in ${row.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreateInFolder(row.id)
                  }}
                >
                  <FilePlus size={15} />
                </button>
              </>
            )}
            <button
              type="button"
              className="tree-action"
              tabIndex={-1}
              title={isFolder ? 'Rename folder' : 'Rename note'}
              aria-label={`Rename ${row.label}`}
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(row.id)
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="tree-action danger"
              tabIndex={-1}
              title={isFolder ? 'Delete folder' : 'Delete note'}
              aria-label={`Delete ${row.label}`}
              onClick={(e) => {
                e.stopPropagation()
                if (isFolder) onDeleteFolder(row.id)
                else onDelete(row.id)
              }}
            >
              <Trash2 size={isFolder ? 15 : 14} />
            </button>
          </span>
        </div>

        {/* A new subfolder is named in place, directly under its parent. */}
        {creatingIn === row.id && (
          <NameInput
            defaultValue="New Folder"
            depth={row.depth + 1}
            label="New folder name"
            onCommit={commitCreateFolder}
            onCancel={() => setCreatingIn(null)}
          />
        )}
      </Fragment>
    )
  }

  const renderResults = (results: SearchResult[]) => {
    if (results.length === 0) {
      return (
        <div className="sidebar-empty">
          No note contains that — titles, paths and contents were all checked.
        </div>
      )
    }
    return (
      <div className="note-tree">
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`tree-row file-row search-result${
              r.id === activeId ? ' active' : ''
            }`}
            onClick={(e) =>
              onSelect(r.id, rectOf(e.currentTarget.querySelector('.tree-label')))
            }
          >
            <span className="tree-icon">
              <FileText size={15} />
            </span>
            <span className="search-result-body">
              <span className="tree-label">{r.title}</span>
              {r.folderPath && (
                <span className="search-result-path">{r.folderPath}</span>
              )}
              {r.snippet && (
                <span className="search-result-snippet">{r.snippet}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    )
  }

  const libraryMenu: MenuItem[] = [
    {
      id: 'new-folder',
      label: 'New folder',
      Icon: FolderPlus,
      run: () => startCreateFolder(''),
    },
    {
      id: 'trash',
      label: 'Recycle Bin',
      Icon: Trash,
      separated: true,
      run: onOpenTrash,
    },
    {
      id: 'import',
      label: 'Import Markdown or a ZIP…',
      Icon: Upload,
      separated: true,
      run: onOpenImport,
    },
    {
      id: 'import-folder',
      label: 'Import a folder…',
      Icon: FolderUp,
      run: onOpenFolderImport,
    },
    {
      id: 'export',
      label: 'Export library as ZIP…',
      Icon: Package,
      run: onOpenExport,
    },
    {
      id: 'switch',
      label: 'Open a different folder…',
      Icon: FolderOpen,
      separated: true,
      run: onSwitchLibrary,
    },
  ]

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-title" title={libraryName ?? 'Notes'}>
          {libraryName ?? 'Notes'}
        </span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenTasks}
            title="Tasks (Ctrl/Cmd+Shift+A)"
            aria-label="Tasks"
          >
            <ListTodo size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenBookmarks}
            title="Bookmarks"
            aria-label="Bookmarks"
          >
            <Bookmark size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onCreate}
            title="New note"
            aria-label="New note"
          >
            <Plus size={20} />
          </button>
          <OverflowMenu items={libraryMenu} label="Library actions" align="right" />
        </div>
      </div>

      <div className="sidebar-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search notes…"
          aria-label="Search notes"
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            onClick={() => onQueryChange('')}
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {searchResults !== null ? (
        renderResults(searchResults)
      ) : (
        <div
          ref={treeRef}
          role="tree"
          aria-label="Notes"
          className={`note-tree${dragOverId === ROOT ? ' drop-target-root' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOverId(ROOT)
          }}
          onDragLeave={() => setDragOverId((cur) => (cur === ROOT ? null : cur))}
          onDrop={(e) => handleDrop(e, '')}
        >
          {rows.length === 0 && creatingIn === null ? (
            <div className="sidebar-empty">
              No notes in this folder yet
              <span className="sidebar-empty-hint">
                Drop <code>.md</code> files here to import them.
              </span>
            </div>
          ) : (
            rows.map(renderRow)
          )}

          {creatingIn === '' && (
            <NameInput
              defaultValue="New Folder"
              depth={0}
              label="New folder name"
              onCommit={commitCreateFolder}
              onCancel={() => setCreatingIn(null)}
            />
          )}
        </div>
      )}

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-footer-btn"
          onClick={onOpenImport}
          title="Import Markdown files, or a ZIP of them, into this library"
        >
          <Upload size={15} />
          Import
        </button>
        <button
          type="button"
          className="sidebar-footer-btn icon-only"
          onClick={onOpenFolderImport}
          title="Import a whole folder of notes"
          aria-label="Import a folder of notes"
        >
          <FolderUp size={15} />
        </button>
        <button
          type="button"
          className="sidebar-footer-btn"
          onClick={onOpenExport}
          title="Export the whole knowledge base as a ZIP"
        >
          <Package size={15} />
          Export
        </button>
      </div>
    </aside>
  )
}
