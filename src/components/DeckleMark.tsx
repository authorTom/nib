/**
 * The mark: a sheet of handmade paper whose right edge was never trimmed — a
 * deckle edge. Inlined rather than loaded as an image so it takes the palette's
 * ink through `currentColor`.
 *
 * `public/deckle.svg` carries the same path with the accent hard-coded, because
 * a favicon has no document to inherit a colour from; keep the two in step.
 * Two copies is the floor — this file exists so a third never appears.
 */
export default function DeckleMark({
  size = 40,
  className = 'gate-mark',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.6 2.5 L19.4 2.5 Q21.3 5.6 19.2 8.8 Q17.4 12 19.5 15.2 Q21.2 18.3 19.2 21.5 L4.6 21.5 Q2.6 17.2 4.9 12.8 Q6.6 7.5 4.6 2.5 Z" />
    </svg>
  )
}
