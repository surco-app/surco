import { barsPath } from '../../lib/envelope'

// Waveforms as a symmetric envelope around a centre axis — the shape a DJ reads —
// rather than bars growing from the floor.
export default function WaveStrip({
  values,
  marks,
  cut,
  cutFrom = 'end',
  height = 'h-24',
  gap,
  label,
  playhead,
  tone = 'blue',
}: {
  values: number[]
  marks?: number[]
  cut?: number
  cutFrom?: 'start' | 'end'
  height?: string
  gap?: number
  label: string
  playhead?: number
  tone?: 'blue' | 'cyan'
}) {
  const fill = tone === 'cyan' ? 'fill-cyan/45' : 'fill-blue/50'
  return (
    <div role="img" aria-label={label} className={`relative w-full ${height}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="block size-full"
      >
        <path d={barsPath(values, 42, gap)} className={fill} />
      </svg>
      {cut !== undefined && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-y-0 bg-bg/78"
            style={
              cutFrom === 'end'
                ? { right: 0, width: `${(1 - cut) * 100}%` }
                : { left: 0, width: `${cut * 100}%` }
            }
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-cyan shadow-[0_0_10px_var(--color-cyan)]"
            style={{ left: `${cut * 100}%` }}
          />
        </>
      )}
      {marks?.map((m) => (
        <span
          key={m}
          aria-hidden="true"
          className="absolute inset-y-2 w-px bg-amber/90"
          style={{ left: `${m * 100}%` }}
        />
      ))}
      {playhead !== undefined && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-fg/70"
          style={{ left: `${playhead * 100}%` }}
        />
      )}
    </div>
  )
}
