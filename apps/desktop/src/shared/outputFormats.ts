import type { FormatSetting, OutputFormat } from './types'

// Typed so the compiler flags a missing entry if OutputFormat ever grows: a plain
// OutputFormat[] accepts a subset silently, which is how three copies of this list
// drifted apart in the first place.
export const OUTPUT_FORMATS = ['aiff', 'alac', 'mp3', 'wav', 'flac'] as const satisfies
  readonly OutputFormat[]

// "Same as source" leads, matching Bit depth and Sample rate in the same panel. AIFF
// stays the app default — the position is for visual consistency, not a behavior change.
export const FORMAT_SETTINGS = ['source', ...OUTPUT_FORMATS] as const satisfies
  readonly FormatSetting[]
