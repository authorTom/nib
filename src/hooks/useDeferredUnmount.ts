import { useEffect, useState } from 'react'

/**
 * Keep a component mounted until its exit animation has finished.
 *
 * Panels unmount the instant `open` goes false, which is why closing one used
 * to pop rather than slide. This holds the render flag on for `ms` after the
 * close, giving the CSS transition something to animate away.
 */
export function useDeferredUnmount(open: boolean, ms: number): boolean {
  const [render, setRender] = useState(open)

  useEffect(() => {
    if (open) {
      setRender(true)
      return
    }
    const timer = setTimeout(() => setRender(false), ms)
    return () => clearTimeout(timer)
  }, [open, ms])

  return render
}
