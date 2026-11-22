// Lengths closer than this are what a drift or a rounding leaves; only past it can two copies
// be different edits.
export const VERSION_GAP_SEC = 2

// The wider search behind PairFacts.versionCorrelation, at a tenth of the probe's rate (the
// bass that carries most of a track's energy survives it). Its reach is bounded so the FFT is
// never longer than 2^19 points, the size of the probe's own: about 54 s either way.
export const VERSION_RATE = 4410
export const VERSION_WINDOW_SECONDS = 10
export const VERSION_FFT_MAX = 2 ** 19
export const VERSION_REACH_MAX_SECONDS = Math.floor(
  (VERSION_FFT_MAX - VERSION_WINDOW_SECONDS * VERSION_RATE) / 2 / VERSION_RATE,
)
