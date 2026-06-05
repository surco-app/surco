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

// Drag-and-drop hands us whatever the user dropped — files *and* folders. A
// dropped folder arrives as a single path that the renderer's extension filter
// silently discards, so here we replace each directory with the audio files it
// contains (recursing into subfolders) and pass plain files through untouched.
// The renderer still runs its own extension/dedupe filter on the result.
export async function expandPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  for (const p of paths) {
    const info = await stat(p).catch(() => null)
    if (!info) continue
    if (info.isDirectory()) {
      out.push(...(await collectAudio(p)))
    } else if (!isHidden(basename(p))) {
      out.push(p)
    }
  }
  return out
}

async function collectAudio(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const entry of entries) {
    if (isHidden(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectAudio(full)))
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}
