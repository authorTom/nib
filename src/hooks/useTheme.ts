import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'notes-theme'
const REVEAL_MS = 420

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const flip = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  /**
   * Swap the theme with a circular wipe out of the control that was clicked.
   *
   * Every surface repaints at once under a View Transition, which is the point:
   * transitioning colours property-by-property leaves borders and panels
   * snapping while the background fades. Falls back to a plain swap where the
   * API is missing or the user has asked for less motion.
   */
  const toggleTheme = useCallback(
    (e?: { clientX: number; clientY: number }) => {
      const start = (document as ViewTransitionDocument).startViewTransition
      if (!start || prefersReducedMotion()) {
        flip()
        return
      }
      const x = e?.clientX ?? window.innerWidth - 40
      const y = e?.clientY ?? 40
      // Radius out to the furthest corner, so the wipe always clears the viewport.
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      )
      const transition = start.call(document, () => flushSync(flip))
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
    [flip],
  )

  return { theme, toggleTheme }
}
