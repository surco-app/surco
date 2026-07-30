// A waveform drawn from measured peaks. Every array it renders came out of real
// audio through ffmpeg — the page argues that the spectrum doesn't lie, so none of
// its own graphics are allowed to.
//
// One <path> rather than a column per peak: 150 flex children would be 150 nodes to
// lay out on every resize, and the path scales to any width without reflowing.
function barsPath(peaks: number[]) {
  const w = 1000
  const gap = 0.28
  const slot = w / peaks.length
  const bar = Math.max(0.6, slot - gap)
  return peaks
    .map((p, i) => {
      const h = Math.max(1.5, p * 100)
      return `M${(i * slot).toFixed(2)} ${((100 - h) / 2).toFixed(2)}h${bar.toFixed(2)}v${h.toFixed(2)}h-${bar.toFixed(2)}z`
    })
    .join('')
}

export default function WaveStrip({
  peaks,
  marks,
  cut,
  cutFrom = 'end',
  height = 'h-20',
  label,
}: {
  peaks: number[]
  marks?: number[]
  cut?: number
  cutFrom?: 'start' | 'end'
  height?: string
  label: string
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`relative overflow-hidden rounded-lg border border-line bg-bg ${height}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="block size-full"
      >
        <path d={barsPath(peaks)} className="fill-blue/55" />
      </svg>
      {cut !== undefined && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-y-0 bg-bg/80"
            style={
              cutFrom === 'end'
                ? { right: 0, width: `${(1 - cut) * 100}%` }
                : { left: 0, width: `${cut * 100}%` }
            }
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-cyan shadow-[0_0_9px_var(--color-cyan)]"
            style={{ left: `${cut * 100}%` }}
          />
        </>
      )}
      {marks?.map((m) => (
        <span
          key={m}
          aria-hidden="true"
          className="absolute inset-y-[8%] w-px bg-amber"
          style={{ left: `${m * 100}%` }}
        />
      ))}
    </div>
  )
}
