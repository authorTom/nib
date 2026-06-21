import { useEffect, useState } from 'react'
import {
  FileDown,
  FileText,
  Maximize2,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
} from 'lucide-react'
import type { Theme } from '../hooks/useTheme'

const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

interface TopBarProps {
  title: string
  /** Persist the (renamed) title — called on blur / Enter, not per keystroke. */
  onTitleCommit: (title: string) => void
  onNew: () => void
  onSaveMarkdown: () => void
  onExportPdf: () => void
  onToggleSidebar: () => void
  onToggleFocus: () => void
  onOpenPalette: () => void
  theme: Theme
  onToggleTheme: () => void
  hasNote: boolean
}

export default function TopBar({
  title,
  onTitleCommit,
  onNew,
  onSaveMarkdown,
  onExportPdf,
  onToggleSidebar,
  onToggleFocus,
  onOpenPalette,
  theme,
  onToggleTheme,
  hasNote,
}: TopBarProps) {
  // Local state for instant typing; renaming the file happens on commit.
  const [localTitle, setLocalTitle] = useState(title)

  // Keep in sync when the title changes externally (e.g. switching notes,
  // or the file being renamed to avoid a collision).
  useEffect(() => {
    setLocalTitle(title)
  }, [title])

  const commit = () => {
    if (localTitle !== title) onTitleCommit(localTitle)
  }

  return (
    <div className="topbar">
      <button
        type="button"
        className="icon-btn hamburger"
        onClick={onToggleSidebar}
        aria-label="Toggle notes list"
      >
        <Menu size={20} />
      </button>

      <input
        className="topbar-title-input"
        value={localTitle}
        onChange={(e) => setLocalTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder="Untitled"
        disabled={!hasNote}
        aria-label="Note title"
      />

      <button
        type="button"
        className="palette-trigger"
        onClick={onOpenPalette}
        title={`Command palette (${MOD_KEY}+K)`}
        aria-label="Open command palette"
      >
        <Search size={15} />
        <span className="palette-trigger-label">Search & commands</span>
        <kbd className="palette-trigger-kbd">{MOD_KEY} K</kbd>
      </button>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={onNew}
          title="New note"
          aria-label="New note"
        >
          <Plus size={20} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onSaveMarkdown}
          disabled={!hasNote}
          title="Download a copy (.md)"
          aria-label="Download a copy as Markdown"
        >
          <FileText size={19} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onExportPdf}
          disabled={!hasNote}
          title="Export to PDF"
          aria-label="Export to PDF"
        >
          <FileDown size={19} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleFocus}
          title="Focus mode (Ctrl/Cmd+Shift+F)"
          aria-label="Focus mode"
        >
          <Maximize2 size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </div>
    </div>
  )
}
