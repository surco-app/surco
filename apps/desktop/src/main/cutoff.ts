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

// A low-bitrate codec can lowpass with a soft transition band rather than a
// brick wall: the energy slides down a ramp no single step trips WALL_DROP_DB.
// Its intermediate rolloff (9–16 kHz) is indistinguishable from genuine
// full-band audio, which can taper just as steeply — so we cannot key on where
// the slide starts. The tell is the top: a soft lossy lowpass has collapsed
// toward the noise floor by Nyquist, while real full-band audio still carries
// measurable energy there. We compare the top band against the 9–11 kHz
// reference plateau (NYQUIST_DROP_DB) to decide cut vs full-band, then place the
// reported edge where the level first fell CUT_EDGE_DB below that plateau.
const REFERENCE_BANDS = 3
const NYQUIST_DROP_DB = 32
const CUT_EDGE_DB = 12

// The band centre frequencies to probe for a given Nyquist, spaced one band
// width apart from BAND_START_HZ up to just under Nyquist (capped at BAND_MAX_HZ).
export function bandFrequencies(nyquistHz: number): number[] {
  const top = Math.min(nyquistHz - BAND_WIDTH_HZ / 2, BAND_MAX_HZ)
  const freqs: number[] = []
  for (let f = BAND_START_HZ; f <= top; f += BAND_WIDTH_HZ) freqs.push(f)
  return freqs
}

// Returns the frequency of the last band before the steepest qualifying drop,
// or the Nyquist frequency when the audio is genuinely full-band. When no
// single-step shelf qualifies, falls back to the Nyquist-collapse test so a soft
// transition band (whose steepest step never reaches WALL_DROP_DB) is still
// caught without flagging full-band audio that merely rolls off toward Nyquist.
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
  if (wallIndex !== -1) return bands[wallIndex].freqHz

  const refCount = Math.min(REFERENCE_BANDS, bands.length)
  if (refCount === 0) return nyquistHz
  const plateau = bands.slice(0, refCount).reduce((sum, b) => sum + b.rmsDb, 0) / refCount
  // Full-band audio keeps energy near Nyquist; a soft lossy lowpass has collapsed
  // toward the noise floor by the top band. Only the latter is a cut.
  if (plateau - bands[bands.length - 1].rmsDb <= NYQUIST_DROP_DB) return nyquistHz
  const edge = plateau - CUT_EDGE_DB
  for (let i = 0; i < bands.length - 1; i++) {
    if (bands[i].rmsDb <= edge) return bands[i].freqHz
  }
  return nyquistHz
}
