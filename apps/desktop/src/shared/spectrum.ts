export const CODEC_WALL_FINE_STEP_DB = 28
// The highest frequency the bands meaningfully cover (the 44.1 kHz Nyquist). Full-band
// audio reports its reach as min(Nyquist, this): on a 44.1 kHz file that is Nyquist itself,
// but on a 96 kHz file (Nyquist 48 kHz) the bands never looked past ~22 kHz, so reporting
// Nyquist would claim a 48 kHz reach we never measured — and contradict the ~20 kHz caption.
export const PROBED_CEILING_HZ = 22050
