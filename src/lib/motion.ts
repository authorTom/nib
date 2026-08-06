/**
 * Where a note switch was triggered from, so the incoming title can fly out of
 * it. Plain numbers rather than a DOMRect: the rect is read at click time and
 * has to survive until the new pane has mounted and measured itself.
 */
export interface FlightOrigin {
  x: number
  y: number
  width: number
  height: number
}

/** Which side the new note should enter from — its direction of travel. */
export type EnterFrom = 'left' | 'right'

export function rectOf(el: Element | null): FlightOrigin | null {
  if (!el) return null
  const { x, y, width, height } = el.getBoundingClientRect()
  return width && height ? { x, y, width, height } : null
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
