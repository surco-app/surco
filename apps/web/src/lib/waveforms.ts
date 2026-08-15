// RMS envelopes measured from real audio with ffmpeg, drawn as discrete bars —
// the way Serato, rekordbox and Surco itself draw a waveform.
//
// Three things these deliberately are not. Peak-per-column: on a loud 90s master
// every column lands near the maximum and the result is a solid slab. One column
// per pixel: the detail collapses into sawtooth texture instead of a shape. And a
// smooth filled curve: this track is compressed hard enough that its envelope is
// almost flat, so a curve reads as a brick no matter how it is traced.
//
// So: root-mean-square per column, few enough columns to stay legible at display
// width, and a gamma of 2.5 pulling the quiet parts down so the hits read as hits.
//
// Source: "Masterboy - Feel The Heat Of The Night (Free & Independent Mix)", FLAC.

// A minute from the middle of the track. Drives the hero.
export const HERO_ENVELOPE = [
  0.71, 0.78, 0.69, 0.38, 0.42, 0.52, 0.6, 0.56, 0.45, 0.37, 0.47, 0.58, 0.55, 0.51, 0.45, 0.42,
  0.48, 0.53, 0.47, 0.47, 0.46, 0.49, 0.47, 0.52, 0.61, 0.49, 0.53, 1, 0.84, 0.73, 0.52, 0.49, 0.44,
  0.47, 0.46, 0.45, 0.49, 0.51, 0.45, 0.48, 0.47, 0.58, 0.53, 0.54, 0.47, 0.38, 0.48, 0.55, 0.57,
  0.42, 0.43, 0.48, 0.46, 0.59, 0.61, 0.58, 0.56, 0.46, 0.41, 0.47, 0.49, 0.59, 0.48, 0.5, 0.45,
  0.58, 0.6, 0.48, 0.51, 0.48, 0.5, 0.58, 0.52, 0.39, 0.53, 0.51, 0.52, 0.58, 0.58, 0.57, 0.45,
  0.26, 0.32, 0.35, 0.53, 0.45, 0.38, 0.37, 0.47, 0.63, 0.56, 0.38, 0.43, 0.44, 0.45, 0.52, 0.58,
  0.47, 0.38, 0.37, 0.42, 0.51, 0.64, 0.52, 0.42, 0.37, 0.47, 0.55, 0.53, 0.47, 0.43, 0.43, 0.42,
  0.49, 0.46, 0.47, 0.43, 0.48, 0.45, 0.49,
]

// The whole track, for the trim overview.
export const TRACK_ENVELOPE = [
  0.04, 0.04, 0.11, 0.08, 0.13, 0.63, 0.62, 0.6, 0.62, 0.59, 0.55, 0.58, 0.62, 0.59, 0.76, 0.8,
  0.76, 0.69, 0.67, 0.84, 0.91, 0.66, 0.71, 0.73, 0.72, 0.71, 0.73, 0.79, 0.71, 0.73, 0.56, 0.69,
  0.67, 0.63, 0.74, 0.66, 0.66, 0.67, 0.68, 0.72, 0.44, 0.05, 0.14, 0.13, 0.08, 0.16, 0.72, 0.74,
  0.74, 0.75, 0.81, 0.68, 0.7, 0.75, 0.67, 0.72, 0.71, 0.76, 0.74, 0.72, 0.71, 0.64, 0.64, 0.62,
  0.71, 0.65, 0.78, 0.65, 0.71, 0.67, 0.69, 0.95, 0.73, 0.73, 0.64, 0.71, 0.76, 0.71, 0.75, 0.74,
  0.77, 0.56, 0.67, 0.74, 0.64, 0.67, 0.69, 0.7, 0.65, 0.59, 0.74, 0.56, 0.66, 0.66, 0.72, 0.69,
  0.81, 0.66, 0.69, 0.63, 0.66, 0.97, 0.78, 0.75, 0.77, 0.78, 0.85, 0.69, 0.67, 0.76, 0.7, 0.7,
  0.69, 0.8, 0.75, 0.7, 0.7, 0.27, 0.04, 0.04, 0.04, 0.04, 0.28, 0.67, 0.73, 0.66, 0.69, 1, 0.64,
  0.58, 0.56, 0.62, 0.62, 0.56, 0.57, 0.64, 0.62, 0.98, 0.69, 0.75, 0.69, 0.68, 0.76, 0.75, 0.76,
  0.7, 0.77, 0.56, 0.04, 0,
]

// The last ten seconds: the real fade to silence.
export const TAIL_ENVELOPE = [
  0.15, 0.93, 0.53, 0.19, 0.46, 0.78, 0.24, 0.19, 1, 0.35, 0.13, 0.42, 0.67, 0.18, 0.25, 0.88, 0.32,
  0.1, 0.72, 0.71, 0.17, 0.3, 0.92, 0.3, 0.11, 0.21, 0.26, 0.21, 0.2, 0.35, 0.23, 0.19, 0.31, 0.28,
  0.24, 0.25, 0.32, 0.29, 0.15, 0.08, 0.07, 0.06, 0.01, 0.01, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]

// Six seconds carrying the injected clicks for the declick A/B.
export const DECLICK_ENVELOPE = [
  0.43, 0.24, 0.14, 0.1, 0.09, 0.49, 0.79, 0.55, 0.34, 0.17, 0.14, 0.29, 0.92, 0.7, 0.26, 0.2, 0.12,
  0.19, 0.58, 0.83, 0.35, 0.21, 0.09, 0.12, 0.34, 0.92, 0.71, 0.26, 0.18, 0.09, 0.2, 0.43, 0.74,
  0.33, 0.27, 0.08, 0.08, 0.45, 0.79, 0.54, 0.27, 0.12, 0.14, 0.26, 0.68, 0.92, 0.37, 0.15, 0.1,
  0.09, 0.53, 0.76, 0.45, 0.24, 0.15, 0.09, 0.26, 0.6, 0.56, 0.39, 0.17, 0.13, 0.18, 0.52, 0.75,
  0.58, 0.25, 0.12, 0.11, 0.38, 0.48, 1, 0.23, 0.17, 0.12, 0.27, 0.54, 0.87, 0.34, 0.23, 0.14, 0.09,
  0.38, 0.74, 0.63, 0.3, 0.17, 0.08, 0.26, 0.63,
]

// Where those clicks sit, as a fraction of the strip.
export const DECLICK_MARKS = [0.074, 0.11, 0.142, 0.226, 0.484, 0.546, 0.589, 0.799, 0.97]

// Fraction of TAIL_ENVELOPE that is fade the trim drops.
export const TAIL_CUT = 0.72
