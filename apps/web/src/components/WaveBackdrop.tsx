// Decorative audio waves behind the pricing/install band. Each layer is a
// periodic path drawn twice side by side, so the -50% drift loops seamlessly;
// different speeds per layer read as depth. Transform-only, GPU-composited.
const WAVES = [
  {
    d: 'M0 110 Q75 55 150 110 T300 110 T450 110 T600 110 T750 110 T900 110 T1050 110 T1200 110',
    stroke: 'var(--color-cyan)',
    opacity: 0.12,
    duration: '40s'
  },
  {
    d: 'M0 110 Q50 82 100 110 T200 110 T300 110 T400 110 T500 110 T600 110 T700 110 T800 110 T900 110 T1000 110 T1100 110 T1200 110',
    stroke: 'var(--color-blue)',
    opacity: 0.1,
    duration: '60s'
  },
  {
    d: 'M0 110 Q60 150 120 110 T240 110 T360 110 T480 110 T600 110 T720 110 T840 110 T960 110 T1080 110 T1200 110',
    stroke: 'var(--color-purple)',
    opacity: 0.08,
    duration: '90s'
  }
]

const FADE = 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)'

export default function WaveBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-1/2 h-72 -translate-y-1/2 overflow-hidden"
      style={{ maskImage: FADE, WebkitMaskImage: FADE }}
    >
      {WAVES.map((w) => (
        <div
          key={w.duration}
          className="wave-drift absolute inset-y-0 left-0 w-[200%]"
          style={{ animationDuration: w.duration }}
        >
          <svg className="h-full w-full" viewBox="0 0 2400 220" preserveAspectRatio="none" fill="none">
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
  )
}
