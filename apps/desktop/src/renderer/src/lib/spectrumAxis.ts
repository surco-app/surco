// The spectrogram image runs 0 Hz at the bottom to its top frequency at the top, linearly.
// The hover crosshair gives a vertical position as a fraction from the TOP (0 = top edge,
// 1 = bottom), so the frequency is that top scaled by how far DOWN we are: top → the top
// frequency, bottom → 0. The fraction is clamped because a cursor can land a hair outside
// the image on a fast drag, and an out-of-range frequency would print an impossible reading.
// Returns null when there is no usable axis (sample rate unknown), so the caller hides the
// crosshair.
export function freqAtFraction(
  fractionFromTop: number,
  sampleRateHz: number,
  imageTopHz?: number,
): number | null {
  if (sampleRateHz <= 0) return null
  const clamped = Math.min(1, Math.max(0, fractionFromTop))
  return (1 - clamped) * spectrumTopHz(sampleRateHz, imageTopHz)
}

// The frequency at the top edge of the image, which every reader of the axis (the kHz marks,
// the cutoff line, the crosshair) must agree on. A hi-res file is drawn to a cap instead of
// its Nyquist, because the octaves above ~22 kHz hold nothing to see and spending most of the
// panel on them squashes the music into a strip at the bottom. Below the cap (44.1/48 kHz)
// Nyquist wins, so those files are drawn exactly as before. An analysis cached before the cap
// existed carries no imageTopHz: its image really was drawn to Nyquist, so it keeps reading
// that way rather than being rescaled to a cap it never used.
export function spectrumTopHz(sampleRateHz: number, imageTopHz?: number): number {
  const nyquist = sampleRateHz / 2
  if (imageTopHz === undefined || imageTopHz <= 0) return nyquist
  return Math.min(nyquist, imageTopHz)
}
