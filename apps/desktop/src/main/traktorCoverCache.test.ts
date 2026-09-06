import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dropCachedCoverArt } from './traktorCoverCache'

// Reported 06/09/2026 and reproduced on five machines: clearing COVERARTID from the
// collection is not enough on its own — Traktor keeps serving the thumbnail it already
// wrote under Coverart/, so the old artwork survives the conversion. Deleting those
// files is what makes it draw the new one. Traktor regenerates them on demand, so this
// costs a re-read, never the artwork itself.
describe('dropCachedCoverArt', () => {
  let dir: string
  let nml: string
  let cache: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'surco-cover-cache-'))
    nml = join(dir, 'collection.nml')
    writeFileSync(nml, '<NML/>')
    cache = join(dir, 'Coverart', '042')
    mkdirSync(cache, { recursive: true })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // Traktor stores several sized variants of one cover under the same id.
  it('deletes every size variant of a cover id', () => {
    for (const variant of ['000', '001', '002']) {
      writeFileSync(join(cache, `ABC${variant}`), 'thumb')
    }

    const dropped = dropCachedCoverArt(nml, ['042/ABC'])

    expect(dropped).toBe(3)
    expect(readdirSync(cache)).toEqual([])
  })

  // Only the ids we actually patched: another track's thumbnail must survive, or a
  // conversion of one file would make the whole collection re-read its artwork.
  it('leaves the thumbnails of untouched tracks alone', () => {
    writeFileSync(join(cache, 'ABC000'), 'mine')
    writeFileSync(join(cache, 'ZZZ000'), 'someone else')

    dropCachedCoverArt(nml, ['042/ABC'])

    expect(readdirSync(cache)).toEqual(['ZZZ000'])
  })

  // The id comes out of the user's own collection file, so it is untrusted input. A
  // traversal must not reach outside the cache — deleting arbitrary files off the back
  // of a malformed NML would be far worse than a stale thumbnail.
  // The file is named for the variant suffix the deletion actually appends, so the
  // traversal would land on a real file: without the containment check this deletes it.
  it('refuses an id that would escape the cache directory', () => {
    writeFileSync(join(dir, 'secret000'), 'keep me')

    const dropped = dropCachedCoverArt(nml, ['../secret'])

    expect(dropped).toBe(0)
    expect(readdirSync(dir)).toContain('secret000')
  })

  // A collection whose cache folder was never created, or a cover id with no files on
  // disk, is normal: nothing to drop and nothing to report.
  it('reports nothing dropped when the cache holds no such cover', () => {
    expect(dropCachedCoverArt(nml, ['042/NOPE'])).toBe(0)
    expect(dropCachedCoverArt(join(dir, 'missing', 'collection.nml'), ['042/ABC'])).toBe(0)
  })

  // An id Traktor never filled in carries no cache entry to drop.
  it('ignores an empty cover id', () => {
    expect(dropCachedCoverArt(nml, [''])).toBe(0)
  })
})
