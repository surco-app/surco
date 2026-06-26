// The spectrogram image runs 0 Hz at the bottom to Nyquist at the top, linearly. The hover
// crosshair gives a vertical position as a fraction from the TOP (0 = top edge, 1 = bottom),
// so the frequency is Nyquist scaled by how far DOWN we are: top → Nyquist, bottom → 0. The
// fraction is clamped because a cursor can land a hair outside the image on a fast drag, and
// an out-of-range frequency would print an impossible reading above Nyquist. Returns null
// when there is no usable axis (sample rate unknown), so the caller hides the crosshair.
export function freqAtFraction(fractionFromTop: number, sampleRateHz: number): number | null {
  if (sampleRateHz <= 0) return null
  const clamped = Math.min(1, Math.max(0, fractionFromTop))
  return (1 - clamped) * (sampleRateHz / 2)
}
