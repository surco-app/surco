// Detects a brick-wall lowpass — the telltale of a lossy codec (MP3/AAC)
// re-wrapped as a lossless file. We probe the energy in successive
// high-frequency bands and look for the sharp shelf itself, NOT where most of
// the spectral energy sits: real music piles almost all its energy in the low
// end, so an energy "rolloff" lands around 12 kHz even when the content reaches
// Nyquist cleanly. Keying on the shelf instead means genuine full-band material
// (whose energy tapers smoothly toward Nyquist) is not mistaken for a cut.

export interface Band {
  freqHz: number
  rmsDb: number
}

export const BAND_WIDTH_HZ = 1000
const BAND_START_HZ = 9000
// Lossy encoders never place their lowpass above ~22 kHz; probing higher only
// risks reading the natural taper near Nyquist as a wall.
const BAND_MAX_HZ = 22000
// A natural HF taper loses a few dB per band step (~3 dB/kHz at its steepest for
// full-band pink noise); a codec brick wall drops by well over ten in a single
// step (~10 dB for a 16 kHz AAC cut, ~17 dB for a 20 kHz MP3 cut). 8 dB sits
// clear of both, validated against real MP3/AAC re-encodes.
const WALL_DROP_DB = 8

// The band centre frequencies to probe for a given Nyquist, spaced one band
// width apart from BAND_START_HZ up to just under Nyquist (capped at BAND_MAX_HZ).
export function bandFrequencies(nyquistHz: number): number[] {
  const top = Math.min(nyquistHz - BAND_WIDTH_HZ / 2, BAND_MAX_HZ)
  const freqs: number[] = []
  for (let f = BAND_START_HZ; f <= top; f += BAND_WIDTH_HZ) freqs.push(f)
  return freqs
}

// Returns the frequency of the last band before the steepest qualifying drop,
// or the Nyquist frequency when the spectrum tapers smoothly (no wall, i.e. the
// audio is genuinely full-band).
export function detectCutoff(bands: Band[], nyquistHz: number): number {
  let wallIndex = -1
  let maxDrop = WALL_DROP_DB
  for (let i = 0; i < bands.length - 1; i++) {
    const drop = bands[i].rmsDb - bands[i + 1].rmsDb
    if (drop >= maxDrop) {
      maxDrop = drop
      wallIndex = i
    }
  }
  return wallIndex === -1 ? nyquistHz : bands[wallIndex].freqHz
}
