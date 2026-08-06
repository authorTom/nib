import { useCallback, useEffect, useRef, useState } from 'react'

/** What the resize crew reads each frame to strike a pose. */
export interface DragInfo {
  /** Pointer position, in viewport coordinates. */
  x: number
  y: number
  /** Direction of travel: 1 right, -1 left, 0 not yet moved. */
  direction: number
  /** How hard the drag is being pushed, 0–1, from pointer speed. */
  effort: number
  /** The panel has hit its min or max and won't move any further. */
  straining: boolean
}

interface ResizeOptions {
  /** localStorage key the width is remembered under. */
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  /** Which edge the handle sits on — decides which way dragging grows the panel. */
  edge: 'left' | 'right'
}

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/**
 * A draggable panel edge.
 *
 * Returns the current width plus the props for the handle. The width is
 * committed to storage only when the drag ends, so a drag writes once rather
 * than on every pointer move.
 */
export function useResizable({
  storageKey,
  defaultWidth,
  min,
  max,
  edge,
}: ResizeOptions) {
  const [width, setWidth] = useState(() => readStored(storageKey, defaultWidth))
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  // Live drag readout for the crew that animates the handle. Deliberately a ref:
  // this changes on every pointermove, and putting it in state would re-render
  // the whole app sixty times a second to move two stick figures.
  const drag = useRef<DragInfo>({
    x: 0,
    y: 0,
    direction: 0,
    effort: 0,
    straining: false,
  })
  const lastMove = useRef({ x: 0, t: 0 })
  const handleRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      startX.current = e.clientX
      startWidth.current = width
      lastMove.current = { x: e.clientX, t: performance.now() }
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        direction: 0,
        effort: 0,
        straining: false,
      }
      setDragging(true)
    },
    [width],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const delta = e.clientX - startX.current
      // A left-edge handle (panels docked right) grows the panel as it moves left.
      const raw = startWidth.current + (edge === 'left' ? -delta : delta)
      const clamped = Math.max(min, Math.min(max, raw))
      setWidth(Math.round(clamped))

      // Effort is pointer speed, normalised and eased — it drives how hard the
      // figures lean, so a slow nudge looks nothing like a hard shove.
      const now = performance.now()
      const dt = Math.max(1, now - lastMove.current.t)
      const step = e.clientX - lastMove.current.x
      const speed = Math.abs(step) / dt
      lastMove.current = { x: e.clientX, t: now }

      drag.current = {
        x: e.clientX,
        y: e.clientY,
        direction: step > 0.5 ? 1 : step < -0.5 ? -1 : drag.current.direction,
        effort: Math.min(1, speed / 1.2),
        // Pushing past the limit is the interesting state: the panel can't move,
        // so the crew visibly loses the fight instead of the drag going quiet.
        straining: Math.abs(raw - clamped) > 8,
      }
    }
    const onUp = () => setDragging(false)
    // Capture phase, so a drag that runs over the editor isn't swallowed by it.
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    // Kill text selection and cursor flicker for the duration of the drag.
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging, edge, min, max])

  // Persist once the drag settles.
  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(storageKey, String(width))
    } catch {
      // Storage disabled — the width just won't survive a reload.
    }
  }, [dragging, width, storageKey])

  /** Keyboard resizing, so the handle isn't mouse-only. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 48 : 16
      const grow = edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
      const shrink = edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
      if (e.key !== grow && e.key !== shrink) return
      e.preventDefault()
      setWidth((w) =>
        Math.round(
          Math.max(min, Math.min(max, w + (e.key === grow ? step : -step))),
        ),
      )
    },
    [edge, min, max],
  )

  const handleProps = {
    ref: handleRef,
    className: `resize-handle resize-handle-${edge}${dragging ? ' dragging' : ''}`,
    onPointerDown,
    onKeyDown,
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-valuenow': width,
    'aria-valuemin': min,
    'aria-valuemax': max,
    tabIndex: 0,
  }

  return { width, dragging, handleProps, drag, handleRef }
}
