import { useEffect, useState } from 'react'
import {
  Columns2,
  FileDown,
  FileText,
  History,
  Maximize2,
  Menu,
  Moon,
  Package,
  Palette,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash,
  Upload,
} from 'lucide-react'
import OverflowMenu, { type MenuItem } from './OverflowMenu'
import SaveIndicator from './SaveIndicator'
import type { SaveState } from '../hooks/useNotes'
import type { Theme } from '../hooks/useTheme'
import { MOD_KEY } from '../lib/platform'



interface TopBarProps {
  title: string
  /** Persist the (renamed) title — called on blur / Enter, not per keystroke. */
  onTitleCommit: (title: string) => void
  onNew: () => void
  onSaveMarkdown: () => void
  onExportPdf: () => void
  onOpenHistory: () => void
  onToggleSidebar: () => void
  onToggleFocus: () => void
  onOpenPalette: () => void
  onOpenAssistant: () => void
  onOpenTrash: () => void
  onOpenImport: () => void
  onOpenExport: () => void
  onOpenAppearance: () => void
  onToggleSplit: () => void
  isSplit: boolean
  saveState: SaveState
  saveError: string | null
  lastSavedAt: number | null
  theme: Theme
  onToggleTheme: (e: React.MouseEvent) => void
  hasNote: boolean
}

/**
 * The chrome above the editor.
 *
 * Only the four controls people reach for constantly stay as buttons; the rest
 * fold into a named menu, which is both less to scan and more discoverable than
 * a row of unlabelled icons.
 */
export default function TopBar({
  title,
  onTitleCommit,
  onNew,
  onSaveMarkdown,
  onExportPdf,
  onOpenHistory,
  onToggleSidebar,
  onToggleFocus,
  onOpenPalette,
  onOpenAssistant,
  onOpenTrash,
  onOpenImport,
  onOpenExport,
  onOpenAppearance,
  onToggleSplit,
  isSplit,
  saveState,
  saveError,
  lastSavedAt,
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

  const menuItems: MenuItem[] = [
    {
      id: 'split',
      label: isSplit ? 'Close split view' : 'Split editor',
      Icon: Columns2,
      hint: `${MOD_KEY} \\`,
      run: onToggleSplit,
    },
    {
      id: 'focus',
      label: 'Focus mode',
      Icon: Maximize2,
      hint: `${MOD_KEY} ⇧ F`,
      run: onToggleFocus,
    },
    {
      id: 'theme',
      label: theme === 'dark' ? 'Light mode' : 'Dark mode',
      Icon: theme === 'dark' ? Sun : Moon,
      run: () =>
        onToggleTheme({
          clientX: window.innerWidth - 40,
          clientY: 40,
        } as React.MouseEvent),
    },
    {
      id: 'appearance',
      label: 'Appearance & themes…',
      Icon: Palette,
      run: onOpenAppearance,
    },
    {
      id: 'history',
      label: 'Version history',
      Icon: History,
      disabled: !hasNote,
      separated: true,
      run: onOpenHistory,
    },
    {
      id: 'download-md',
      label: 'Download a copy (.md)',
      Icon: FileText,
      disabled: !hasNote,
      run: onSaveMarkdown,
    },
    {
      id: 'export-pdf',
      label: 'Export to PDF',
      Icon: FileDown,
      disabled: !hasNote,
      run: onExportPdf,
    },
    {
      id: 'import',
      label: 'Import Markdown…',
      Icon: Upload,
      separated: true,
      run: onOpenImport,
    },
    {
      id: 'export-zip',
      label: 'Export library as ZIP…',
      Icon: Package,
      run: onOpenExport,
    },
    {
      id: 'trash',
      label: 'Recycle Bin',
      Icon: Trash,
      separated: true,
      run: onOpenTrash,
    },
  ]

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

      <span className="topbar-title">
        <FileText size={14} aria-hidden="true" />
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
          // Names the field for what it actually is. The heading inside the
          // document is the note's title; this is the file it lives in.
          aria-label="File name"
          title="File name — the note's own heading is in the document"
        />
      </span>

      <SaveIndicator
        state={saveState}
        error={saveError}
        lastSavedAt={lastSavedAt}
      />

      <button
        type="button"
        className="palette-trigger"
        onClick={onOpenPalette}
        title={`Command palette (${MOD_KEY}+K)`}
        aria-label="Open command palette"
      >
        <Search size={15} />
        <span className="palette-trigger-label">Search &amp; commands</span>
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
          onClick={onOpenAssistant}
          title="AI assistant"
          aria-label="AI assistant"
        >
          <Sparkles size={18} />
        </button>
        <button
          type="button"
          className="icon-btn theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <OverflowMenu items={menuItems} />
      </div>
    </div>
  )
}
