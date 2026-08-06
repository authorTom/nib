import { useEffect, useState } from 'react'

/**
 * Drive a CSS enter/exit transition on a component that unmounts when closed.
 *
 * `render` stays true for `ms` after `open` goes false, so the exit transition
 * has something to run on; `entered` flips on one frame *after* mount, so the
 * element paints in its closed state first and the browser has two values to
 * transition between.
 */
export function useEnterExit(open: boolean, ms: number) {
  const [render, setRender] = useState(open)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (open) {
      setRender(true)
      // Two frames: the first commits the closed state, the second starts the
      // transition. One frame alone is unreliable across browsers.
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setEntered(true)),
      )
      return () => cancelAnimationFrame(raf)
    }
    setEntered(false)
    const timer = setTimeout(() => setRender(false), ms)
    return () => clearTimeout(timer)
  }, [open, ms])

  return { render, entered }
}
