// Detects the lowpass of a lossy codec — the telltale of an MP3/AAC re-encoded
// as a higher quality file. We probe the energy in successive high-frequency
// bands and look for the lowpass itself: a drop that never recovers. Real music
// piles almost all its energy in the low end and tapers smoothly toward
// Nyquist, so neither the taper's steepness nor where it crosses some level
// says "cut" — keying on either is what flagged healthy 320s as fakes. Only a
// sustained knee is a codec lowpass; without one we report how far meaningful
// energy extends and let the verdict grade that honestly.

export interface Band {
  freqHz: number
  rmsDb: number
}

export interface CutoffResult {
  cutoffHz: number
  // True when the highs rise where natural spectra only fall — the signature of
  // an "enhancer"/upscaler regenerating synthetic content over a low-bitrate
  // source. cutoffHz then points at the valley: the source's real ceiling.
  processed: boolean
  // True only when a sustained knee was found — a genuine codec lowpass. When
  // false, cutoffHz is just how far a smoothly tapering spectrum extends, NOT a
  // lossy cut: every real codec lowpass trips the knee, so a knee-free reading is
  // a genuine master (often a dark one). The verdict leans on this so it never
  // demotes a knee-free taper the way grading its extent on the codec scale did.
  hasKnee: boolean
}

export const BAND_WIDTH_HZ = 1000
const BAND_START_HZ = 9000
// Lossy encoders never place their lowpass above ~22 kHz; probing higher only
// risks reading the natural taper near Nyquist as a wall.
const BAND_MAX_HZ = 22000
// A natural HF taper loses a few dB per band step (~3 dB/kHz at its steepest
// for full-band pink noise, under 5 dB on measured real tracks); a codec
// lowpass drops 7 dB or more in a single step even when its transition band is
// soft (6.9–7.8 dB measured on real ~160–192 kbps re-encodes, 10–17 dB on
// brick walls). 6 dB splits the two populations.
const KNEE_DROP_DB = 6
// A codec lowpass never recovers: everything above the knee stays collapsed.
// A resonant notch can drop just as sharply but bounces back — allowing this
// much rebound past measurement jitter tells the two apart.
const KNEE_RECOVERY_DB = 2
// The 9–11 kHz bands are the reference plateau the rest of the curve is read
// against: every real track keeps solid energy there, so it normalizes quiet
// masters and loud ones alike.
const REFERENCE_BANDS = 3
// Where a knee-free taper stops carrying meaningful energy. 25 dB below the
// plateau is still well above any codec floor (a real cut collapses 30–40 dB)
// but past the point where content contributes audible air; measured healthy
// 320s extend to ~18 kHz by this rule while genuine full-band masters reach the
// top band.
const EXTENT_DROP_DB = 25
// Natural spectra only fall through the top octave; a rise this far back above
// the running minimum is regenerated content...
const HUMP_RISE_DB = 5
// ...provided it climbs back near the reference plateau. A notch recovery also
// rises, but only to rejoin the falling trend below the plateau — synthetic
// highs push up to reference level, louder than bands an octave lower.
const HUMP_PLATEAU_MARGIN_DB = 2

// Reconstructed highs (HE-AAC SBR, spectral-band enhancers) can defeat every
// coarse rule: they track the music, sit below the hump threshold and taper
// smoothly to Nyquist. Their trace is spectral, not temporal — at 500 Hz
// resolution the transposed patches meet in a saw-tooth, while genuine spectra
// keep falling monotonically (0 dB of rises measured across every real file in
// the corpus vs 5–11.5 dB on the synthetic ones).
export const FINE_BAND_WIDTH_HZ = 500
const FINE_BAND_START_HZ = 13000
const FINE_BAND_MAX_HZ = 21000
// Only the region above the typical patch crossover counts; below it, real
// content is loud enough to mask any patch border.
const ROUGHNESS_START_HZ = 16500
// Rises below this are measurement jitter, not structure.
const ROUGHNESS_RISE_MIN_DB = 1
// Total rise that marks a saw-tooth. Real files measured 0; synthetic 5–11.5.
const ROUGHNESS_TOTAL_DB = 3
// With the saw-tooth established, the source's real ceiling is where the first
// sharp fine-band drop appears — the edge the patches were grafted onto.
const ROUGHNESS_EDGE_DROP_DB = 4

// A 44.1→48/96 kHz upsample ("fake hi-res") walls off at 22.05 kHz — the source's
// original Nyquist — even though the container claims headroom to 24/48 kHz. We
// probe one 500 Hz band fully below the wall (21.5 kHz) and one fully above it
// (23.5 kHz): a genuine high-rate master tapers ~8 dB across that span, an upsample
// collapses ~15–20 dB into the resampler's stopband. 12 dB splits the two with ~3 dB
// of margin on the calibration set (native vs upsampled pink noise; one real 48 kHz
// master; one real upsample). Only meaningful when Nyquist clears the upper band, so
// it never fires on a native 44.1 kHz file (whose taper near its own Nyquist is not a
// wall). Scoped to the 22.05 kHz wall — the common fake — not 48→96 (24 kHz) walls.
export const UPSAMPLE_PROBE_BELOW_HZ = 21500
export const UPSAMPLE_PROBE_ABOVE_HZ = 23500
export const UPSAMPLE_MIN_NYQUIST_HZ = 23750
const UPSAMPLE_WALL_DROP_DB = 12

// The band centre frequencies to probe for a given Nyquist, spaced one band
// width apart from BAND_START_HZ up to just under Nyquist (capped at BAND_MAX_HZ).
export function bandFrequencies(nyquistHz: number): number[] {
  const top = Math.min(nyquistHz - BAND_WIDTH_HZ / 2, BAND_MAX_HZ)
  const freqs: number[] = []
  for (let f = BAND_START_HZ; f <= top; f += BAND_WIDTH_HZ) freqs.push(f)
  return freqs
}

// The fine-resolution probe for the patch region, same shape as bandFrequencies.
export function fineBandFrequencies(nyquistHz: number): number[] {
  const top = Math.min(nyquistHz - FINE_BAND_WIDTH_HZ / 2, FINE_BAND_MAX_HZ)
  const freqs: number[] = []
  for (let f = FINE_BAND_START_HZ; f <= top; f += FINE_BAND_WIDTH_HZ) freqs.push(f)
  return freqs
}

function plateauDb(bands: Band[]): number {
  const refCount = Math.min(REFERENCE_BANDS, bands.length)
  return bands.slice(0, refCount).reduce((sum, b) => sum + b.rmsDb, 0) / refCount
}

// The valley a synthetic hump rises from, or null for a naturally falling
// spectrum. Tracks the running minimum and looks for a later band that climbs
// HUMP_RISE_DB back above it AND reaches the reference plateau — both
// conditions, so a notch recovering to the falling trend stays clean.
function findHumpValley(bands: Band[], plateau: number): Band | null {
  let valley = bands[0]
  for (const b of bands) {
    if (b.rmsDb < valley.rmsDb) valley = b
    const rise = b.rmsDb - valley.rmsDb
    if (rise >= HUMP_RISE_DB && b.rmsDb >= plateau - HUMP_PLATEAU_MARGIN_DB) return valley
  }
  return null
}

// The steepest single-step drop that the spectrum never recovers from, or -1.
// Sustained is what makes it a codec lowpass rather than a notch or a wiggle.
function findKneeIndex(bands: Band[]): number {
  let kneeIndex = -1
  let maxDrop = KNEE_DROP_DB
  for (let i = 0; i < bands.length - 1; i++) {
    const drop = bands[i].rmsDb - bands[i + 1].rmsDb
    if (drop < maxDrop) continue
    const ceiling = bands[i + 1].rmsDb + KNEE_RECOVERY_DB
    if (bands.slice(i + 2).some((b) => b.rmsDb > ceiling)) continue
    maxDrop = drop
    kneeIndex = i
  }
  return kneeIndex
}

// The ceiling the synthetic patches were grafted onto, or null when the fine
// bands fall monotonically (genuine audio). Non-finite readings are dropped
// rather than compared: one unparsed band against a real one would read as an
// infinite rise and flag every track the moment parsing hiccups.
function roughnessCeiling(fineBands: Band[]): Band | null {
  const finite = fineBands.filter((b) => Number.isFinite(b.rmsDb))
  let totalRise = 0
  for (let i = 0; i < finite.length - 1; i++) {
    if (finite[i + 1].freqHz <= ROUGHNESS_START_HZ) continue
    const rise = finite[i + 1].rmsDb - finite[i].rmsDb
    if (rise > ROUGHNESS_RISE_MIN_DB) totalRise += rise
  }
  if (totalRise < ROUGHNESS_TOTAL_DB) return null
  for (let i = 0; i < finite.length - 1; i++) {
    if (finite[i].rmsDb - finite[i + 1].rmsDb >= ROUGHNESS_EDGE_DROP_DB) return finite[i]
  }
  return finite[0] ?? null
}

// Returns where the audio's real bandwidth ends. A sustained knee places it at
// the band before the drop; a synthetic hump places it at the valley the hump
// papers over; a fine-band saw-tooth places it at the patch edge; a knee-free
// taper reads as its energy extent — the last band still within EXTENT_DROP_DB
// of the reference plateau — and full-band audio (extent reaching the top
// probed band) reports Nyquist.
export function detectCutoff(
  bands: Band[],
  nyquistHz: number,
  fineBands: Band[] = [],
): CutoffResult {
  if (bands.length < 2) return { cutoffHz: nyquistHz, processed: false, hasKnee: false }

  const plateau = plateauDb(bands)
  const valley = findHumpValley(bands, plateau)
  if (valley) return { cutoffHz: valley.freqHz, processed: true, hasKnee: false }

  const kneeIndex = findKneeIndex(bands)
  if (kneeIndex !== -1)
    return { cutoffHz: bands[kneeIndex].freqHz, processed: false, hasKnee: true }

  const ceiling = roughnessCeiling(fineBands)
  if (ceiling) return { cutoffHz: ceiling.freqHz, processed: true, hasKnee: false }

  const floor = plateau - EXTENT_DROP_DB
  for (let i = bands.length - 1; i >= 0; i--) {
    if (bands[i].rmsDb < floor) continue
    return {
      cutoffHz: i === bands.length - 1 ? nyquistHz : bands[i].freqHz,
      processed: false,
      hasKnee: false,
    }
  }
  return { cutoffHz: nyquistHz, processed: false, hasKnee: false }
}

// True when the spectrum walls off at the 22.05 kHz 44.1 Nyquist on a higher-rate
// file — a 44.1→48/96 upsample. belowDb/aboveDb are the RMS of the 21.5 kHz and
// 23.5 kHz probe bands. A non-finite reading (an unparsed band, or true silence we
// can't tell from a parse hiccup) is left unflagged rather than risk a false
// positive, matching how the roughness pass treats -Infinity.
export function detectUpsample(belowDb: number, aboveDb: number): boolean {
  if (!Number.isFinite(belowDb) || !Number.isFinite(aboveDb)) return false
  return belowDb - aboveDb >= UPSAMPLE_WALL_DROP_DB
}
