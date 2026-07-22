import type { FormatSetting, OutputFormat } from './types'

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

// Whether an export edits the source file in place (rewrite/rename where it lives)
// instead of writing a fresh copy to the output folder: the target format is the one
// the file is already in, or overwrite mode forces it. ALAC keeps its never-in-place
// invariant even under overwrite — the .m4a source it would replace may hold lossy
// AAC, and re-encoding it over itself destroys the only true copy while presenting a
// lossy encode as lossless. The main process and the editor's warnings both decide
// through here so what the UI promises is what resolveOutputTarget does.
export function editsInPlace(
  format: OutputFormat,
  inputPath: string,
  overwriteOriginal = false,
): boolean {
  return (overwriteOriginal && format !== 'alac') || formatMatchesInput(format, inputPath)
}

// Whether 'source' has a real OutputFormat to keep a file in. Surco imports .opus,
// .ogg, .oga, .aac, .m4a and .mp4, none of which INPUT_EXT maps to — resolveJobFormat
// would fall back and transcode those, which the renderer's 'source' skip (see
// useTrackProcessing.processOne) uses this to catch before that fallback ever fires.
export function hasFormatEquivalent(inputPath: string): boolean {
  return (Object.keys(INPUT_EXT) as OutputFormat[]).some((f) => formatMatchesInput(f, inputPath))
}

// Turns the Default format setting into the format a single job will actually use.
// 'source' keeps each file in the format it already has, which is what lets a mixed
// batch be tagged without re-encoding — planConversion stream-copies when input and
// output formats agree. Inputs with no matching output format (Surco imports .opus,
// .ogg, .aac and .mp4, which no OutputFormat represents) fall back and transcode, the
// same as they do today. ALAC is never resolved from an .m4a source: INPUT_EXT.alac
// deliberately matches nothing, since the container may hold lossy AAC.
export function resolveJobFormat(
  setting: FormatSetting,
  inputPath: string,
  fallback: OutputFormat,
): OutputFormat {
  if (setting !== 'source') return setting
  const match = (Object.keys(INPUT_EXT) as OutputFormat[]).find((f) =>
    formatMatchesInput(f, inputPath),
  )
  return match ?? fallback
}
