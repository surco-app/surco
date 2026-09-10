import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { nativeImage } from 'electron'
import type { CoverRefresh } from './traktorNml'

// Traktor renders every cover into its own thumbnail cache and serves the library's
// artwork from there, never from the audio file. Clearing COVERARTID from the ENTRY
// only asks it to re-read — and what it re-reads is the thumbnail already sitting in
// that cache, so the old picture survives a conversion either way. Replacing the bytes
// under the id Traktor already has is what actually retires the old artwork, and it
// keeps the ENTRY pointed at a cover that exists, so nothing is ever re-analysed.
//
// The three sizes are Traktor's own; writing only one leaves the other views of the
// library still showing the old art.
const VARIANTS: [suffix: string, px: number][] = [
  ['000', 125],
  ['001', 75],
  ['002', 56],
]

const CACHE_DIR = 'Coverart'

// Confirmed against the reporter's install: the cache does not always hang off the
// collection's own folder — some setups keep it one level above, beside the versioned
// "Traktor X.Y.Z" directory. Deducing it from the .nml alone finds nothing there and
// the refresh silently does nothing, so both places are tried.
function cacheRoots(nmlPath: string): string[] {
  const beside = dirname(nmlPath)
  return [join(beside, CACHE_DIR), join(dirname(beside), CACHE_DIR)]
}

// A COVERARTID is untrusted: it comes out of the user's own collection file, and a
// malformed or hostile value must not turn a cache refresh into writing files elsewhere
// on disk. Resolving and then checking containment catches traversal whatever shape it
// arrives in, which pattern-matching the id would not.
function insideCache(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

// Traktor splits the id as "<folder>/<name>" and stores the variants as <name><suffix>
// inside that folder. Windows collections carry it with a backslash.
function idParts(id: string): { folder: string; name: string } | null {
  const normalized = id.replace(/\\/g, '/')
  const folder = dirname(normalized)
  const name = basename(normalized)
  if (!name || folder === '.' || folder === '/') return null
  return { folder, name }
}

// Rasterises once per size. Returns null when the image cannot be read at all — an
// unreadable cover must leave the cache untouched rather than blank out the thumbnails
// Traktor is happily showing.
interface RenderedThumbnail {
  png: Buffer
  // Null when this build cannot produce a bitmap. The PNG still applies, so a cache
  // written in PNG keeps working rather than the whole refresh going dark.
  native: Buffer | null
}

// Traktor commonly stores Coverart as 0x08 + little-endian width/height + BGRA pixels,
// not as a PNG. Preserve the format of each existing cache file: replacing a native
// thumbnail with PNG bytes succeeds on disk but Traktor ignores it and keeps showing the
// old image. Electron's toBitmap() is BGRA on macOS, exactly the payload Traktor uses.
//
// Rendered in its own try: the two formats fail independently, and folding this into the
// caller's catch let a missing toBitmap discard the PNG as well, silently disabling the
// refresh for every cover instead of only the native ones.
function nativeThumbnail(image: Electron.NativeImage, px: number): Buffer | null {
  try {
    const bitmap = image.toBitmap()
    if (!bitmap?.length) return null
    const header = Buffer.alloc(9)
    header[0] = 0x08
    header.writeUInt32LE(px, 1)
    header.writeUInt32LE(px, 5)
    return Buffer.concat([header, bitmap])
  } catch {
    return null
  }
}

function thumbnails(cover: Buffer): Map<string, RenderedThumbnail> | null {
  try {
    const source = nativeImage.createFromBuffer(cover)
    if (source.isEmpty()) return null
    const out = new Map<string, RenderedThumbnail>()
    for (const [suffix, px] of VARIANTS) {
      const resized = source.resize({ width: px, height: px })
      out.set(suffix, { png: resized.toPNG(), native: nativeThumbnail(resized, px) })
    }
    return out
  } catch {
    return null
  }
}

// Replaces the cached thumbnails of exactly the covers named, in place and under their
// existing ids, and returns how many files were written. Never throws: this runs after
// the collection has already been written, and a cache refresh that cannot complete
// must not turn a finished sync into a failure — the worst case is the stale thumbnail
// the user already had.
export function refreshCachedCoverArt(
  nmlPath: string,
  refreshes: CoverRefresh[],
  readCover: (file: string) => Buffer | null,
): number {
  if (refreshes.length === 0) return 0
  const roots = cacheRoots(nmlPath).map((root) => resolve(root))

  let written = 0
  for (const { coverId, file } of refreshes) {
    const parts = idParts(coverId)
    if (!parts) continue
    const cover = readCover(file)
    if (!cover) continue
    const rendered = thumbnails(cover)
    if (!rendered) continue
    for (const root of roots) {
      const folder = resolve(join(root, parts.folder))
      if (!insideCache(root, folder)) continue
      // Only replace what Traktor already cached. Creating a file for an id whose cache
      // entry does not exist would invent a thumbnail nothing points at, and on the
      // wrong root of the two it would litter a folder Traktor never reads.
      const present = VARIANTS.filter(([suffix]) => existsSync(join(folder, parts.name + suffix)))
      if (present.length === 0) continue
      for (const [suffix] of present) {
        const target = join(folder, parts.name + suffix)
        const thumbnail = rendered.get(suffix)
        if (!thumbnail) continue
        try {
          const existing = readFileSync(target)
          // A native thumbnail we could not render stays as it is: writing PNG into it
          // would be a write Traktor ignores, costing the old picture for nothing.
          const replacement = existing[0] === 0x08 ? thumbnail.native : thumbnail.png
          if (!replacement) continue
          // Traktor is closed here (syncCollection checked twice), so a plain write is
          // safe and keeps the inode — no rename that could land on a different volume.
          if (existing.equals(replacement)) continue
          writeFileSync(target, replacement)
          written++
        } catch {
          // A locked or read-only thumbnail costs the old picture, nothing more.
        }
      }
      break
    }
  }
  return written
}
