import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

const AUDIO_EXTS = new Set(['.wav', '.flac', '.aif', '.aiff', '.mp3'])

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
    } else {
      out.push(p)
    }
  }
  return out
}

async function collectAudio(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const entry of entries) {
    // macOS leaves a hidden "._name" AppleDouble companion beside each real file on
    // exFAT/FAT/network volumes. They share the audio extension, so without this they
    // load as duplicate tracks holding resource-fork bytes as junk metadata.
    if (entry.name.startsWith('._')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectAudio(full)))
    } else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}
