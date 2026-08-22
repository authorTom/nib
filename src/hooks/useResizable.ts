import { useCallback, useEffect, useRef, useState } from 'react'

/** What the resize crew reads each frame to strike a pose. */
export interface DragInfo {
  /** Pointer position, in viewport coordinates. */
  x: number
  y: number
  /** Direction of travel: 1 right/down, -1 left/up, 0 not yet moved. */
  direction: number
  /** How hard the drag is being pushed, 0–1, from pointer speed. */
  effort: number
  /** The panel has hit its min or max and won't move any further. */
  straining: boolean
}

/**
 * Which edge the handle sits on. This decides both the axis it travels along
 * and which way dragging grows the panel: a handle on the far edge grows with
 * the pointer, one on the near edge grows against it.
 */
export type ResizeEdge = 'left' | 'right' | 'bottom'

interface ResizeOptions {
  /** localStorage key the size is remembered under. */
  storageKey: string
  defaultSize: number
  min: number
  max: number
  edge: ResizeEdge
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
 * Returns the current size plus the props for the handle. `size` is a width for
 * a left/right handle and a height for a bottom one — the hook doesn't care
 * which, it just measures along the one axis the edge implies. The size is
 * committed to storage only when the drag ends, so a drag writes once rather
 * than on every pointer move.
 */
export function useResizable({
  storageKey,
  defaultSize,
  min,
  max,
  edge,
}: ResizeOptions) {
  const vertical = edge === 'bottom'
  const [size, setSize] = useState(() => readStored(storageKey, defaultSize))
  const [dragging, setDragging] = useState(false)
  const startPos = useRef(0)
  const startSize = useRef(0)
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
  const lastMove = useRef({ pos: 0, t: 0 })
  const handleRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const pos = vertical ? e.clientY : e.clientX
      startPos.current = pos
      startSize.current = size
      lastMove.current = { pos, t: performance.now() }
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        direction: 0,
        effort: 0,
        straining: false,
      }
      setDragging(true)
    },
    [size, vertical],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const pos = vertical ? e.clientY : e.clientX
      const delta = pos - startPos.current
      // A left-edge handle (panels docked right) grows the panel as it moves
      // left. Right and bottom handles both sit on the growing edge, so they
      // follow the pointer.
      const raw = startSize.current + (edge === 'left' ? -delta : delta)
      const clamped = Math.max(min, Math.min(max, raw))
      setSize(Math.round(clamped))

      // Effort is pointer speed, normalised and eased — it drives how hard the
      // figures lean, so a slow nudge looks nothing like a hard shove.
      const now = performance.now()
      const dt = Math.max(1, now - lastMove.current.t)
      const step = pos - lastMove.current.pos
      const speed = Math.abs(step) / dt
      lastMove.current = { pos, t: now }

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
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging, edge, vertical, min, max])

  // Persist once the drag settles.
  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(storageKey, String(size))
    } catch {
      // Storage disabled — the size just won't survive a reload.
    }
  }, [dragging, size, storageKey])

  /** Keyboard resizing, so the handle isn't mouse-only. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 48 : 16
      const grow = vertical ? 'ArrowDown' : edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
      const shrink = vertical ? 'ArrowUp' : edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
      if (e.key !== grow && e.key !== shrink) return
      e.preventDefault()
      setSize((w) =>
        Math.round(
          Math.max(min, Math.min(max, w + (e.key === grow ? step : -step))),
        ),
      )
    },
    [edge, vertical, min, max],
  )

  const handleProps = {
    ref: handleRef,
    className: `resize-handle resize-handle-${edge}${dragging ? ' dragging' : ''}`,
    onPointerDown,
    onKeyDown,
    role: 'separator' as const,
    // The separator's own orientation, not the axis it travels: a handle you
    // drag up and down is a horizontal divider.
    'aria-orientation': (vertical ? 'horizontal' : 'vertical') as
      | 'horizontal'
      | 'vertical',
    'aria-valuenow': size,
    'aria-valuemin': min,
    'aria-valuemax': max,
    tabIndex: 0,
  }

  return { size, dragging, handleProps, drag, handleRef }
}
