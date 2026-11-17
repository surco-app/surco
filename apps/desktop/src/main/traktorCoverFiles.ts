import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { MEDIA_SCHEME } from '../shared/media'

// Traktor renders every cover into its own thumbnail cache and serves the library's
// artwork from there, never from the audio file. Clearing COVERARTID from the ENTRY
// only asks it to re-read — and what it re-reads is the thumbnail already sitting in
// that cache, so the old picture survives a conversion either way. Replacing the bytes
// under the id Traktor already has is what actually retires the old artwork, and it
// keeps the ENTRY pointed at a cover that exists, so nothing is ever re-analysed.
//
// The three sizes are Traktor's own; writing only one leaves the other views of the
// library still showing the old art.
export const VARIANTS: [suffix: string, px: number][] = [
  ['000', 125],
  ['001', 75],
  ['002', 56],
]

const CACHE_DIR = 'Coverart'

// Confirmed against the reporter's install: the cache does not always hang off the
// collection's own folder — some setups keep it one level above, beside the versioned
// "Traktor X.Y.Z" directory. Deducing it from the .nml alone finds nothing there and
// the refresh silently does nothing, so both places are tried.
export function cacheRoots(nmlPath: string): string[] {
  const beside = dirname(nmlPath)
  return [join(beside, CACHE_DIR), join(dirname(beside), CACHE_DIR)]
}

// A COVERARTID is untrusted: it comes out of the user's own collection file, and a
// malformed or hostile value must not turn a cache refresh into writing files elsewhere
// on disk. Resolving and then checking containment catches traversal whatever shape it
// arrives in, which pattern-matching the id would not.
export function insideCache(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

// Traktor splits the id as "<folder>/<name>" and stores the variants as <name><suffix>
// inside that folder. Windows collections carry it with a backslash.
export function idParts(id: string): { folder: string; name: string } | null {
  const normalized = id.replace(/\\/g, '/')
  const folder = dirname(normalized)
  const name = basename(normalized)
  if (!name || folder === '.' || folder === '/') return null
  return { folder, name }
}

// The largest thumbnail Traktor keeps for a cover, or null when its cache holds none. The
// list paints a Traktor row from it, as it paints a rekordbox row from rekordbox's own art,
// so the row's file needs only the light read.
export function traktorCoverFile(nmlPath: string, coverId: string): string | null {
  const parts = idParts(coverId)
  if (!parts) return null
  for (const root of cacheRoots(nmlPath).map((r) => resolve(r))) {
    const file = resolve(join(root, parts.folder, parts.name + VARIANTS[0][0]))
    if (insideCache(root, file) && existsSync(file)) return file
  }
  return null
}

const COVER_HOST = 'traktor-cover'

export function traktorCoverUrl(coverId: string): string {
  return `${MEDIA_SCHEME}://${COVER_HOST}/${encodeURIComponent(coverId)}`
}

export function traktorCoverIdOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== COVER_HOST) return null
  return decodeURIComponent(parsed.pathname.replace(/^\//, '')) || null
}
