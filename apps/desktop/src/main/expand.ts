import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

// Beyond the four output formats, ffmpeg also decodes AAC/ALAC (.m4a/.mp4/.aac — what
// Apple Music libraries are made of) and Ogg Vorbis/Opus (.ogg/.oga/.opus — Bandcamp and
// the like). None match an output, so they always transcode rather than stream-copy.
const AUDIO_EXTS = new Set([
  '.wav',
  '.flac',
  '.aif',
  '.aiff',
  '.mp3',
  '.m4a',
  '.mp4',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
])

// macOS scatters hidden files beside real ones — most notably the "._name"
// AppleDouble companions it writes on exFAT/FAT/network volumes, which share the
// audio extension and would otherwise load as duplicate tracks full of
// resource-fork junk. Skip every hidden (dot-prefixed) entry, whether it's dropped
// directly or found while walking a folder: a folder drop can hand the renderer the
// child files instead of the directory, so both branches must guard against it.
function isHidden(name: string): boolean {
  return name.startsWith('.')
}

// Surco's own conversion temps ("name.tmp-xxxxxxxx.ext", see convertTmpPath) are
// written beside the output and renamed over it when done. New temps are also
// dot-prefixed (hidden), but Windows shows dotfiles and older versions wrote them
// visible, so the pattern is skipped explicitly too — without it, watching an
// output folder surfaces the half-written temp as a "new track" that vanishes on
// the rename, leaving a ghost row where every analysis fails.
function isConversionTemp(name: string): boolean {
  return /\.tmp-[0-9a-f]{8}\.[^.]+$/i.test(name)
}

// Drag-and-drop hands us whatever the user dropped — files *and* folders. A
// dropped folder arrives as a single path that the renderer's extension filter
// silently discards, so here we replace each directory with the audio files it
// contains (recursing into subfolders) and pass plain files through untouched.
// The renderer still runs its own extension/dedupe filter on the result.
// Walk the dropped paths concurrently rather than one after another: the renderer awaits
// this whole walk before the first track row appears, and on a deep or network (SMB)
// folder a serial walk adds up every directory's round-trip latency, leaving the list
// empty for seconds. Promise.all resolves in input order, so the result order is
// identical to a serial walk — only the wall-clock collapses. Fan-out is bounded by the
// tree's directory count, which is modest for a music library.
export async function expandPaths(paths: string[]): Promise<string[]> {
  const expanded = await Promise.all(
    paths.map(async (p) => {
      const info = await stat(p).catch(() => null)
      if (!info) return []
      if (info.isDirectory()) return collectAudio(p)
      const name = basename(p)
      return isHidden(name) || isConversionTemp(name) ? [] : [p]
    }),
  )
  return expanded.flat()
}

export async function collectAudio(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (isHidden(entry.name) || isConversionTemp(entry.name)) return []
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return collectAudio(full)
      return AUDIO_EXTS.has(extname(entry.name).toLowerCase()) ? [full] : []
    }),
  )
  return nested.flat()
}
