/**
 * The ragged edge on the ink bloom.
 *
 * An SVG filter is referenced by id, so exactly one copy may be mounted at a
 * time — and a `filter: url(#…)` that resolves to nothing doesn't degrade to an
 * unfiltered shape, it stops the element rendering at all. The app and the
 * vault gate are mutually exclusive screens, so each mounts its own and neither
 * has to know about the other.
 */
export default function InkFilter() {
  return (
    <svg className="visually-hidden" aria-hidden="true" focusable="false">
      <filter id="nib-ink">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.018"
          numOctaves="3"
          seed="7"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="34"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  )
}
