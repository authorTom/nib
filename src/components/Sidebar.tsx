import { Fragment, useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Search,
  Trash,
  Trash2,
  X,
} from 'lucide-react'
import type { TreeNode } from '../fs/vault'
import type { SearchResult } from '../hooks/useNotes'

interface SidebarProps {
  tree: TreeNode[]
  activeId: string | null
  open: boolean
  vaultName: string | null
  query: string
  searchResults: SearchResult[] | null
  onQueryChange: (q: string) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onCreateInFolder: (folderPath: string) => void
  onCreateFolder: (parentPath: string) => Promise<string | undefined>
  onDeleteFolder: (folderPath: string) => void
  onMoveNote: (id: string, targetFolderPath: string) => void
  onDelete: (id: string) => void
  onSwitchVault: () => void
  onOpenTrash: () => void
}

const ROOT = '__root__'

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

export default function Sidebar({
  tree,
  activeId,
  open,
  vaultName,
  query,
  searchResults,
  onQueryChange,
  onSelect,
  onCreate,
  onCreateInFolder,
  onCreateFolder,
  onDeleteFolder,
  onMoveNote,
  onDelete,
  onSwitchVault,
  onOpenTrash,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Auto-expand the folders leading to the active note.
  useEffect(() => {
    if (!activeId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of ancestorFolderIds(activeId)) next.add(id)
      return next
    })
  }, [activeId])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const expand = (id: string) =>
    setExpanded((prev) => new Set(prev).add(id))

  const handleNewFolder = async (parentPath: string) => {
    const newId = await onCreateFolder(parentPath)
    if (newId) {
      if (parentPath) expand(parentPath)
      expand(newId)
    }
  }

  const handleDrop = (e: DragEvent, targetFolderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverId(null)
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    onMoveNote(id, targetFolderPath)
    if (targetFolderPath) expand(targetFolderPath)
  }

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: 8 + depth * 14 }

      if (node.kind === 'folder') {
        const isOpen = expanded.has(node.id)
        return (
          <Fragment key={node.id}>
            <button
              type="button"
              className={`tree-row folder-row${
                dragOverId === node.id ? ' drop-target' : ''
              }`}
              style={indent}
              onClick={() => toggle(node.id)}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragOverId(node.id)
              }}
              onDragLeave={() =>
                setDragOverId((cur) => (cur === node.id ? null : cur))
              }
              onDrop={(e) => handleDrop(e, node.id)}
            >
              <span className="tree-chevron">
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </span>
              <span className="tree-icon">
                {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
              </span>
              <span className="tree-label">{node.name}</span>
              <span
                className="tree-action"
                role="button"
                tabIndex={0}
                title="New subfolder"
                aria-label="New subfolder"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleNewFolder(node.id)
                }}
              >
                <FolderPlus size={15} />
              </span>
              <span
                className="tree-action"
                role="button"
                tabIndex={0}
                title="New note in this folder"
                aria-label="New note in this folder"
                onClick={(e) => {
                  e.stopPropagation()
                  onCreateInFolder(node.id)
                }}
              >
                <FilePlus size={15} />
              </span>
              <span
                className="tree-action"
                role="button"
                tabIndex={0}
                title="Delete folder"
                aria-label="Delete folder"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteFolder(node.id)
                }}
              >
                <Trash2 size={15} />
              </span>
            </button>
            {isOpen && renderNodes(node.children, depth + 1)}
          </Fragment>
        )
      }

      return (
        <button
          key={node.id}
          type="button"
          draggable
          className={`tree-row file-row${node.id === activeId ? ' active' : ''}`}
          style={indent}
          onClick={() => onSelect(node.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', node.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDragOverId(null)}
        >
          <span className="tree-chevron" />
          <span className="tree-icon">
            <FileText size={15} />
          </span>
          <span className="tree-label">{node.title}</span>
          <span
            className="tree-action"
            role="button"
            tabIndex={0}
            title="Delete note"
            aria-label="Delete note"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(node.id)
            }}
          >
            <Trash2 size={14} />
          </span>
        </button>
      )
    })

  const renderResults = (results: SearchResult[]) => {
    if (results.length === 0) {
      return <div className="sidebar-empty">No matches</div>
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
            onClick={() => onSelect(r.id)}
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

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-title" title={vaultName ?? 'Notes'}>
          {vaultName ?? 'Notes'}
        </span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenTrash}
            title="Recycle bin"
            aria-label="Recycle bin"
          >
            <Trash size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onSwitchVault}
            title="Open a different folder"
            aria-label="Open a different folder"
          >
            <FolderOpen size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void handleNewFolder('')}
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlus size={18} />
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
      ) : tree.length === 0 ? (
        <div className="sidebar-empty">No notes in this folder yet</div>
      ) : (
        <div
          className={`note-tree${dragOverId === ROOT ? ' drop-target-root' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOverId(ROOT)
          }}
          onDrop={(e) => handleDrop(e, '')}
        >
          {renderNodes(tree, 0)}
        </div>
      )}
    </aside>
  )
}
