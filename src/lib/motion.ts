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

/**
 * How long a floating surface takes to leave.
 *
 * Deliberately shorter than its entrance: arriving is worth watching, leaving
 * is just getting out of the way, and a slow exit reads as lag. Must match the
 * exit duration on `.modal-overlay` / `.modal` in global.css — the unmount
 * waits exactly this long for the transition to finish.
 */
export const OVERLAY_EXIT_MS = 120
