import { existsSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

// Traktor renders each cover into its own thumbnail cache, in a Coverart folder beside
// the collection, and serves the track's artwork from there. Clearing COVERARTID from
// the ENTRY tells it to re-read — but the file it re-reads into is the one already
// sitting in that cache, so on its own the old picture survives a conversion. Deleting
// the cached variants is what actually makes the new artwork appear (reported
// 06/09/2026, reproduced on five machines).
//
// Losing one is harmless: Traktor regenerates a thumbnail the next time it draws the
// track. That asymmetry is why this deletes rather than rewrites — writing a thumbnail
// means guessing Traktor's own encoding, while deleting only costs it a re-read.
const CACHE_DIR = 'Coverart'

// One logical cover is stored as several sized variants sharing the id, distinguished
// by a three-digit suffix. These are the ones Traktor writes.
const VARIANTS = ['000', '001', '002']

// A COVERARTID comes out of the user's own collection file, so it is untrusted: a
// malformed or hostile value must not turn a cache cleanup into deleting files
// elsewhere on disk. Resolving and then checking containment (rather than pattern
// matching the id) catches traversal whatever shape it arrives in.
function insideCache(cacheRoot: string, candidate: string): boolean {
  const rel = relative(cacheRoot, candidate)
  return (
    rel !== '' &&
    !rel.startsWith('..') &&
    !rel.startsWith(sep) &&
    !resolve(candidate).includes('..')
  )
}

// Deletes the cached thumbnails for exactly the covers named, and returns how many
// files went. Never throws: this runs after the collection has already been written,
// and a cleanup that cannot complete must not turn a finished sync into a failure —
// the worst case is the stale thumbnail the user already had.
export function dropCachedCoverArt(nmlPath: string, coverIds: string[]): number {
  const cacheRoot = join(dirname(nmlPath), CACHE_DIR)
  if (!existsSync(cacheRoot)) return 0

  let dropped = 0
  for (const id of coverIds) {
    if (!id) continue
    for (const variant of VARIANTS) {
      const target = resolve(join(cacheRoot, `${id}${variant}`))
      if (!insideCache(resolve(cacheRoot), target)) continue
      try {
        if (!existsSync(target)) continue
        unlinkSync(target)
        dropped++
      } catch {
        // A locked or already-gone file costs a stale thumbnail, nothing more.
      }
    }
  }
  return dropped
}
