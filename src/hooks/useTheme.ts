import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { DEFAULT_THEME, THEMES } from '../themes/themes'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'notes-theme'
const PALETTE_KEY = 'notes-palette'
const UNLOCKED_KEY = 'notes-unlocked-themes'
const REVEAL_MS = 420

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getInitialPalette(): string {
  try {
    const stored = localStorage.getItem(PALETTE_KEY)
    return stored && THEMES.some((t) => t.id === stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function getUnlocked(): string[] {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Firefox has no View Transitions yet, and the DOM typings lag the browsers. */
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [palette, setPaletteState] = useState<string>(getInitialPalette)
  const [unlocked, setUnlocked] = useState<string[]>(getUnlocked)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage disabled — the choice just won't survive a reload.
    }
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette)
    try {
      localStorage.setItem(PALETTE_KEY, palette)
    } catch {
      // As above.
    }
  }, [palette])

  /**
   * Repaint every surface at once behind a circular wipe from the control that
   * was used.
   *
   * Transitioning colours property-by-property leaves borders and panels
   * snapping while the background fades; a View Transition swaps the whole
   * frame. Falls back to a plain change where the API is missing or the user
   * has asked for less motion.
   */
  const withReveal = useCallback(
    (change: () => void, e?: { clientX: number; clientY: number }) => {
      const start = (document as ViewTransitionDocument).startViewTransition
      if (!start || prefersReducedMotion()) {
        change()
        return
      }
      const x = e?.clientX ?? window.innerWidth - 40
      const y = e?.clientY ?? 40
      // Radius out to the furthest corner, so the wipe always clears the viewport.
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      )
      const transition = start.call(document, () => flushSync(change))
      void transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: REVEAL_MS,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
    },
    [],
  )

  const toggleTheme = useCallback(
    (e?: { clientX: number; clientY: number }) => {
      withReveal(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), e)
    },
    [withReveal],
  )

  const setPalette = useCallback(
    (id: string, e?: { clientX: number; clientY: number }) => {
      withReveal(() => setPaletteState(id), e)
    },
    [withReveal],
  )

  /** Reveal a secret theme and switch to it. Persisted, so it stays found. */
  const unlockTheme = useCallback(
    (id: string, e?: { clientX: number; clientY: number }) => {
      setUnlocked((prev) => {
        if (prev.includes(id)) return prev
        const next = [...prev, id]
        try {
          localStorage.setItem(UNLOCKED_KEY, JSON.stringify(next))
        } catch {
          // The theme still applies for this session.
        }
        return next
      })
      setPalette(id, e)
    },
    [setPalette],
  )

  /** Themes to offer in the picker: everything but the secrets not yet found. */
  const availableThemes = THEMES.filter((t) => !t.secret || unlocked.includes(t.id))

  return {
    theme,
    toggleTheme,
    palette,
    setPalette,
    availableThemes,
    unlocked,
    unlockTheme,
  }
}
