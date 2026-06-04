import { stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { formatMatchesInput } from '../shared/format'
import type { OutputFormat } from '../shared/types'

export interface OutputTarget {
  outputPath: string
  // True when the export matched the source format, so the file is rewritten where
  // it lives (in place) rather than copied into the output folder.
  inPlace: boolean
}

// Decides where an export lands. Same format as the source → edit the original
// file right where it lives (rewrite tags, rename if the name changed); a real
// conversion (e.g. WAV→MP3) → a fresh file in the output folder, original kept.
// `name` is the already-sanitized base name, with no extension.
export function resolveOutputTarget(
  inputPath: string,
  name: string,
  format: OutputFormat,
  outputDir: string,
): OutputTarget {
  const inPlace = formatMatchesInput(format, inputPath)
  const dir = inPlace ? dirname(inputPath) : outputDir
  return { outputPath: join(dir, `${name}.${format}`), inPlace }
}

// After an in-place edit, convertAudio has already written the (possibly renamed)
// file; drop the original only when the rename left it behind as a genuinely
// different file. We compare device+inode rather than the path string because a
// rename that only changes case (Song.WAV → Song.wav) is the *same* file on the
// case-insensitive macOS/Windows volumes Surco runs on — unlinking the old path
// there would delete the file we just wrote.
export async function removeRenamedOriginal(input: string, output: string): Promise<void> {
  if (input === output) return
  const [inStat, outStat] = await Promise.all([stat(input).catch(() => null), stat(output)])
  if (inStat && (inStat.ino !== outStat.ino || inStat.dev !== outStat.dev)) {
    await unlink(input)
  }
}
