import { stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { formatExtension, formatMatchesInput } from '../shared/format'
import type { OutputFormat } from '../shared/types'

// Cleans a generated output name that may carry "/" separators (subfolders the file-name
// template asks for). Each segment is sanitized of filesystem-illegal characters on its
// own so the slashes survive as directory boundaries, and a segment a blank field left
// empty is dropped so no stray "" directory is created. "/" is the cross-platform
// separator here; join() turns it into the OS one when the path is built.
export function sanitizeOutputName(name: string): string {
  return name
    .split('/')
    .map((segment) =>
      segment
        .replace(/[\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('/')
}

export interface OutputTarget {
  outputPath: string
  // True when the export matched the source format, so the file is rewritten where
  // it lives (in place) rather than copied into the output folder.
  inPlace: boolean
}

// Decides where an export lands. Same format as the source → edit the original
// file right where it lives (rewrite tags, rename if the name changed); a real
// conversion (e.g. WAV→MP3) → a fresh file in the output folder, original kept.
// `overwriteOriginal` forces the in-place path regardless of format: the converted
// file replaces the source in its own folder, and removeRenamedOriginal drops the
// old-extension original afterwards. `name` is the already-sanitized base name.
export function resolveOutputTarget(
  inputPath: string,
  name: string,
  format: OutputFormat,
  outputDir: string,
  overwriteOriginal = false,
): OutputTarget {
  const inPlace = overwriteOriginal || formatMatchesInput(format, inputPath)
  const dir = inPlace ? dirname(inputPath) : outputDir
  return { outputPath: join(dir, `${name}.${formatExtension(format)}`), inPlace }
}

// Whether a conversion would clobber an unrelated file. A real conversion writing
// over an existing target is a collision worth a prompt — unless the target is the
// same track's own previous output (the intended re-export overwrite). In-place
// edits rewrite the source itself, so they're never a collision.
export function isOutputConflict(
  outputPath: string,
  previousOutputPath: string | undefined,
  inPlace: boolean,
  outputExists: boolean,
): boolean {
  return !inPlace && outputExists && outputPath !== previousOutputPath
}

// Finds the first free "name (n).ext" beside a taken path, so "keep both" never
// overwrites. `exists` is injected so the choice stays a pure, testable decision.
export function uniqueOutputPath(outputPath: string, exists: (p: string) => boolean): string {
  if (!exists(outputPath)) return outputPath
  const dir = dirname(outputPath)
  const ext = extname(outputPath)
  const base = basename(outputPath, ext)
  let n = 2
  while (exists(join(dir, `${base} (${n})${ext}`))) n++
  return join(dir, `${base} (${n})${ext}`)
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
