import { useEffect, useRef, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { DragInfo } from '../hooks/useResizable'
import { prefersReducedMotion } from '../lib/motion'

interface ResizeCrewProps {
  dragging: boolean
  drag: MutableRefObject<DragInfo>
  /** The divider itself — the crew stands on it, not on the pointer. */
  handleRef: MutableRefObject<HTMLDivElement | null>
}

/**
 * Two ink-drawn figures who shove the panel divider around while you drag it.
 *
 * The conceit is that they're margin doodles — the thing you'd actually scribble
 * next to a paragraph — so a cartoon in a notes app reads as belonging rather
 * than bolted on. They're stroked in `currentColor`, so they take on whatever
 * theme is active.
 *
 * The pose is not decoration alone. Lean tracks how fast you're dragging, and
 * when the panel hits its minimum or maximum the pusher's feet start slipping
 * with scuff marks flying — which is how you find out you've hit the limit,
 * instead of the drag just going silently dead.
 *
 * Rendered through a portal and driven from a rAF loop reading a ref: the docks
 * clip their overflow, and putting pointer coordinates into React state would
 * re-render the app on every mouse move.
 */
export default function ResizeCrew({
  dragging,
  drag,
  handleRef,
}: ResizeCrewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<SVGSVGElement>(null)
  const rightRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!dragging || prefersReducedMotion()) return
    let frame = 0
    // Lean is smoothed towards its target rather than tracking raw pointer
    // speed, which is jittery enough to make the figures vibrate.
    let lean = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const root = rootRef.current
      if (!root) return
      const { y, direction, effort, straining } = drag.current

      // Straining leans further: all that force going nowhere.
      const target = direction * (10 + effort * 16 + (straining ? 12 : 0))
      lean += (target - lean) * 0.2

      // Anchored to the divider rather than the cursor. Once the panel hits its
      // limit the two part company, and the crew staying put while the pointer
      // runs off is exactly what shows you the panel has stopped. Read here in
      // rAF, so it's a post-layout measurement and not a thrash per mousemove.
      const rect = handleRef.current?.getBoundingClientRect()
      const x = rect ? rect.left + rect.width / 2 : drag.current.x
      root.style.transform = `translate3d(${x}px, ${y}px, 0)`
      root.classList.toggle('straining', straining)
      for (const el of [leftRef.current, rightRef.current]) {
        el?.style.setProperty('--lean', lean.toFixed(2))
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dragging, drag, handleRef])

  if (!dragging || prefersReducedMotion()) return null

  return createPortal(
    <div className="resize-crew" ref={rootRef} aria-hidden="true">
      <Figure innerRef={leftRef} side="left" />
      <Figure innerRef={rightRef} side="right" />
    </div>,
    document.body,
  )
}

/**
 * One figure, drawn to stand on the origin so `--lean` can rotate it about its
 * feet. The right-hand one is mirrored, and its lean negated to compensate, so
 * both tip the same way on screen while facing each other.
 */
function Figure({
  innerRef,
  side,
}: {
  // Named, not `ref`: on React 18 a plain `ref` prop is intercepted rather than
  // passed through, so the element would never reach the animation loop.
  innerRef: React.Ref<SVGSVGElement>
  side: 'left' | 'right'
}) {
  return (
    <svg
      ref={innerRef}
      className={`crew-figure crew-${side}`}
      viewBox="-14 -26 30 30"
      width="30"
      height="30"
    >
      {/* Scuff marks, only visible while the feet are slipping. */}
      <g className="crew-scuff">
        <path d="M-13,1.5 L-8,1.5" />
        <path d="M-11,4 L-7.5,4" />
      </g>
      <circle className="crew-head" cx="0" cy="-20" r="3.4" />
      <path className="crew-spine" d="M0,-16.6 L0,-7" />
      <path className="crew-arms" d="M0,-14 L7.5,-11.5" />
      <path className="crew-leg crew-leg-back" d="M0,-7 L-6,0" />
      <path className="crew-leg crew-leg-front" d="M0,-7 L5,0" />
    </svg>
  )
}
