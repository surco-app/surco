const W = 1000
const MID = 50

// A waveform as discrete bars around a centre axis, which is how every DJ tool draws
// one. The filled-curve version this replaced looked like a brick: the source track
// is compressed hard enough that its envelope barely moves, so a smooth outline had
// nothing to describe. Bars keep each column readable as its own hit.
//
// Emitted as one <path> of rectangles rather than one node per bar, so a 150-column
// waveform is still a single element to lay out.
export function barsPath(values: number[], amp = 44, gap = 0.22) {
  if (values.length === 0) return ''
  const slot = W / values.length
  const width = Math.max(0.5, slot * (1 - gap))
  const inset = (slot - width) / 2
  return values
    .map((v, i) => {
      const h = Math.max(0.6, v * amp)
      const x = i * slot + inset
      return `M${x.toFixed(1)},${(MID - h).toFixed(1)}h${width.toFixed(1)}v${(h * 2).toFixed(1)}h-${width.toFixed(1)}z`
    })
    .join('')
}
