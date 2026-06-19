// Faint vinyl-groove arcs — Surco's namesake — peeking in from a page edge
// and rotating imperceptibly, so the dashed gaps drift over time. The rotation
// animates the standalone `rotate` property, leaving the centering translate
// untouched and the whole thing on the compositor.
const RINGS = [
  { r: 120, dash: '140 80', stroke: 'var(--color-cyan)', opacity: 0.07 },
  { r: 165, dash: '220 120', stroke: 'var(--color-blue)', opacity: 0.06 },
  { r: 210, dash: '180 150', stroke: 'var(--color-cyan)', opacity: 0.05 },
  { r: 255, dash: '300 110', stroke: 'var(--color-blue)', opacity: 0.04 }
]

const FADE = 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)'

export default function GrooveArcs({
  className = '',
  side = 'right'
}: {
  className?: string
  side?: 'left' | 'right'
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 h-[480px] -translate-y-1/2 overflow-hidden ${className}`}
      style={{ maskImage: FADE, WebkitMaskImage: FADE }}
    >
      <svg
        aria-hidden="true"
        className={`spin-slow absolute top-1/2 h-[560px] w-[560px] -translate-y-1/2 ${
          side === 'right' ? '-right-52' : '-left-52'
        }`}
        viewBox="0 0 560 560"
        fill="none"
      >
        {RINGS.map((ring) => (
          <circle
            key={ring.r}
            cx="280"
            cy="280"
            r={ring.r}
            stroke={ring.stroke}
            strokeOpacity={ring.opacity}
            strokeWidth="1"
            strokeDasharray={ring.dash}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  )
}
