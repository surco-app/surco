import type { OutputFormat } from './types'

// AIFF rips use both .aif and .aiff; everything else is a single extension. These
// mirror the input-detection ffmpeg.ts uses to decide on a stream copy.
const INPUT_EXT: Record<OutputFormat, RegExp> = {
  mp3: /\.mp3$/i,
  wav: /\.wav$/i,
  flac: /\.flac$/i,
  aiff: /\.aiff?$/i,
  // Deliberately never matches: an .m4a source may hold lossy AAC, not ALAC — telling
  // them apart needs a codec probe, and calling it "already ALAC" would rewrite the
  // user's original in place. ALAC exports always render a fresh file instead.
  alac: /(?!)/,
}

// True when the chosen export format is the one the file is already in. The main
// process uses it to edit the original in place (stream copy + tag rewrite, no
// copy in the output folder); the renderer uses it to tell the user which of the
// two will happen before they export.
export function formatMatchesInput(format: OutputFormat, input: string): boolean {
  return INPUT_EXT[format].test(input)
}

// The on-disk extension for a chosen output format. Every format names its own
// extension except ALAC, which lives in an MPEG-4 container (.m4a).
export function formatExtension(format: OutputFormat): string {
  return format === 'alac' ? 'm4a' : format
}
