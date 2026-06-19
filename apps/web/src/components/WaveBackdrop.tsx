// Decorative audio waves, scattered at several points down the page. Each
// layer is a periodic path drawn twice side by side, so the -50% drift loops
// seamlessly; different speeds per layer read as depth. flip/side/delay vary
// each instance so no two bands look alike. Opacities stay very low because
// the bands sit behind body text. Transform-only, GPU-composited.
const WAVES = [
  {
    d: 'M0 110 Q75 55 150 110 T300 110 T450 110 T600 110 T750 110 T900 110 T1050 110 T1200 110',
    stroke: 'var(--color-cyan)',
    opacity: 0.07,
    duration: '40s'
  },
  {
    d: 'M0 110 Q50 82 100 110 T200 110 T300 110 T400 110 T500 110 T600 110 T700 110 T800 110 T900 110 T1000 110 T1100 110 T1200 110',
    stroke: 'var(--color-blue)',
    opacity: 0.06,
    duration: '60s'
  },
  {
    d: 'M0 110 Q60 150 120 110 T240 110 T360 110 T480 110 T600 110 T720 110 T840 110 T960 110 T1080 110 T1200 110',
    stroke: 'var(--color-purple)',
    opacity: 0.05,
    duration: '90s'
  }
]

const FADE_Y = 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)'
const FADE_X = {
  full: undefined,
  left: 'linear-gradient(to right, black 40%, transparent 92%)',
  right: 'linear-gradient(to left, black 40%, transparent 92%)'
}

export default function WaveBackdrop({
  className = '',
  side = 'full',
  flip = false,
  delay = '0s'
}: {
  className?: string
  side?: keyof typeof FADE_X
  flip?: boolean
  delay?: string
}) {
  const fadeX = FADE_X[side]
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 h-72 -translate-y-1/2 overflow-hidden ${className}`}
      style={{ maskImage: FADE_Y, WebkitMaskImage: FADE_Y }}
    >
      <div
        className="absolute inset-0"
        style={fadeX ? { maskImage: fadeX, WebkitMaskImage: fadeX } : undefined}
      >
        <div className={`absolute inset-0 ${flip ? '-scale-x-100' : ''}`}>
          {WAVES.map((w) => (
            <div
              key={w.duration}
              className="wave-drift absolute inset-y-0 left-0 w-[200%]"
              style={{ animationDuration: w.duration, animationDelay: delay }}
            >
              <svg
                aria-hidden="true"
                className="h-full w-full"
                viewBox="0 0 2400 220"
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  d={w.d}
                  stroke={w.stroke}
                  strokeOpacity={w.opacity}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={w.d}
                  transform="translate(1200 0)"
                  stroke={w.stroke}
                  strokeOpacity={w.opacity}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
