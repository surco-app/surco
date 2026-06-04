import type { OutputFormat } from './types'

// AIFF rips use both .aif and .aiff; everything else is a single extension. These
// mirror the input-detection ffmpeg.ts uses to decide on a stream copy.
const INPUT_EXT: Record<OutputFormat, RegExp> = {
  mp3: /\.mp3$/i,
  wav: /\.wav$/i,
  flac: /\.flac$/i,
  aiff: /\.aiff?$/i,
}

// True when the chosen export format is the one the file is already in. The main
// process uses it to edit the original in place (stream copy + tag rewrite, no
// copy in the output folder); the renderer uses it to tell the user which of the
// two will happen before they export.
export function formatMatchesInput(format: OutputFormat, input: string): boolean {
  return INPUT_EXT[format].test(input)
}
