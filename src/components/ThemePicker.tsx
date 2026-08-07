import { useEffect } from 'react'
import { useEnterExit } from '../hooks/useEnterExit'
import { OVERLAY_EXIT_MS } from '../lib/motion'
import { Check, Moon, Sun, X } from 'lucide-react'
import type { ThemeInfo } from '../themes/themes'
import type { Theme } from '../hooks/useTheme'

interface ThemePickerProps {
  open: boolean
  onClose: () => void
  themes: ThemeInfo[]
  palette: string
  onPickPalette: (id: string, e: React.MouseEvent) => void
  theme: Theme
  onToggleTheme: (e: React.MouseEvent) => void
}

/**
 * Appearance picker.
 *
 * Palette and light/dark are separate choices — every palette ships both — so
 * the mode toggle sits above the grid rather than being duplicated per card.
 * Each swatch previews the palette in the *current* mode, so what you see is
 * what you'd get.
 */
export default function ThemePicker({
  open,
  onClose,
  themes,
  palette,
  onPickPalette,
  theme,
  onToggleTheme,
}: ThemePickerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  // Stays mounted for the length of its exit, so the surface leaves the
  // way it arrived instead of blinking out.
  const anim = useEnterExit(open, OVERLAY_EXIT_MS)
  if (!anim.render) return null

  return (
    <div className={`modal-overlay${anim.entered ? ' entered' : ''}`} onMouseDown={onClose}>
      <div
        className={`modal theme-modal${anim.entered ? ' entered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Appearance"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Appearance</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="theme-mode-row">
          <span className="theme-mode-label">Mode</span>
          <div className="theme-mode-toggle" role="group" aria-label="Light or dark">
            <button
              type="button"
              className={`theme-mode-btn${theme === 'light' ? ' active' : ''}`}
              aria-pressed={theme === 'light'}
              onClick={(e) => theme !== 'light' && onToggleTheme(e)}
            >
              <Sun size={15} />
              Light
            </button>
            <button
              type="button"
              className={`theme-mode-btn${theme === 'dark' ? ' active' : ''}`}
              aria-pressed={theme === 'dark'}
              onClick={(e) => theme !== 'dark' && onToggleTheme(e)}
            >
              <Moon size={15} />
              Dark
            </button>
          </div>
        </div>

        <div className="modal-body theme-grid">
          {themes.map((t) => {
            const selected = t.id === palette
            return (
              <button
                key={t.id}
                type="button"
                className={`theme-card${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={(e) => onPickPalette(t.id, e)}
              >
                <span className="theme-swatch" aria-hidden="true">
                  {(theme === 'dark' ? t.swatchDark : t.swatch).map((colour, i) => (
                    <span key={i} style={{ background: colour }} />
                  ))}
                </span>
                <span className="theme-card-body">
                  <span className="theme-card-name">
                    {t.name}
                    {t.secret && <span className="theme-badge">found</span>}
                  </span>
                  <span className="theme-card-desc">{t.description}</span>
                </span>
                {selected && (
                  <span className="theme-tick" aria-hidden="true">
                    <Check size={15} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
