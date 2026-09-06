import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// nativeImage is Electron's, so the unit tests stub it: the sizes and the bytes written
// are what this module is responsible for, not Chromium's rasteriser.
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: (buf: Buffer) => makeImage(buf.toString(), 0) },
}))

function makeImage(source: string, size: number) {
  return {
    isEmpty: () => source === '',
    resize: ({ width }: { width: number }) => makeImage(source, width),
    toPNG: () => Buffer.from(`png:${size}`),
  }
}

import { refreshCachedCoverArt } from './traktorCoverCache'

// Reported 06/09/2026 and reproduced on five machines: after a conversion Traktor kept
// drawing the old cover. Clearing COVERARTID and waiting for Traktor to regenerate is
// the mechanism the user already tried and abandoned — what works is keeping the id
// Traktor has and overwriting the three thumbnails it serves from its own cache.
describe('refreshCachedCoverArt', () => {
  let dir: string
  let nml: string
  let cache: string
  const readCover = () => Buffer.from('art')
  const noCover = () => null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'surco-cover-cache-'))
    nml = join(dir, 'collection.nml')
    writeFileSync(nml, '<NML/>')
    cache = join(dir, 'Coverart', '042')
    mkdirSync(cache, { recursive: true })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function seed(): void {
    for (const variant of ['000', '001', '002']) {
      writeFileSync(join(cache, `ABC${variant}`), 'stale thumbnail')
    }
  }

  // The three sizes Traktor itself writes. Getting one wrong leaves that view of the
  // library showing the old art while the others update.
  it('overwrites the three native thumbnails at their own sizes', () => {
    seed()

    const written = refreshCachedCoverArt(
      nml,
      [{ coverId: '042/ABC', file: '/Music/uno.flac' }],
      readCover,
    )

    expect(written).toBe(3)
    expect(readFileSync(join(cache, 'ABC000'), 'utf8')).toBe('png:125')
    expect(readFileSync(join(cache, 'ABC001'), 'utf8')).toBe('png:75')
    expect(readFileSync(join(cache, 'ABC002'), 'utf8')).toBe('png:56')
  })

  // The point of the whole approach: the id stays linked to the ENTRY, so Traktor is
  // never asked to re-analyse anything — it just finds new bytes where it already looks.
  it('never renames or removes the files, only replaces their bytes', () => {
    seed()

    refreshCachedCoverArt(nml, [{ coverId: '042/ABC', file: '/Music/uno.flac' }], readCover)

    expect(readdirSync(cache).sort()).toEqual(['ABC000', 'ABC001', 'ABC002'])
  })

  // Confirmed on the reporter's own install (COVERARTID 068/ESITK3BN…): some setups
  // keep Coverart one level ABOVE the collection, so deducing the folder from the .nml
  // alone finds nothing and the refresh silently does nothing.
  it('finds a Coverart folder that sits one level above the collection', () => {
    const above = join(dir, '..', 'Coverart')
    const nested = mkdtempSync(join(tmpdir(), 'surco-nested-'))
    const deepNml = join(nested, 'Traktor 4.5.0', 'collection.nml')
    mkdirSync(join(nested, 'Traktor 4.5.0'), { recursive: true })
    writeFileSync(deepNml, '<NML/>')
    const upperCache = join(nested, 'Coverart', '068')
    mkdirSync(upperCache, { recursive: true })
    writeFileSync(join(upperCache, 'XYZ000'), 'stale')

    const written = refreshCachedCoverArt(
      deepNml,
      [{ coverId: '068/XYZ', file: '/Music/x.flac' }],
      readCover,
    )

    expect(written).toBeGreaterThan(0)
    expect(readFileSync(join(upperCache, 'XYZ000'), 'utf8')).toBe('png:125')
    rmSync(nested, { recursive: true, force: true })
    rmSync(above, { recursive: true, force: true })
  })

  // Only the covers we patched: another track's thumbnail must not be rewritten.
  it('leaves the thumbnails of untouched tracks alone', () => {
    seed()
    writeFileSync(join(cache, 'ZZZ000'), 'someone else')

    refreshCachedCoverArt(nml, [{ coverId: '042/ABC', file: '/Music/uno.flac' }], readCover)

    expect(readFileSync(join(cache, 'ZZZ000'), 'utf8')).toBe('someone else')
  })

  // The id comes out of the user's own collection file, so it is untrusted input: a
  // traversal must not let a malformed NML write outside the cache.
  it('refuses an id that would escape the cache directory', () => {
    writeFileSync(join(dir, 'secret000'), 'keep me')

    const written = refreshCachedCoverArt(
      nml,
      [{ coverId: '../secret', file: '/Music/uno.flac' }],
      readCover,
    )

    expect(written).toBe(0)
    expect(readFileSync(join(dir, 'secret000'), 'utf8')).toBe('keep me')
  })

  // A cover Traktor never cached has nothing to replace: writing a new file there would
  // invent a thumbnail for an id nothing points at.
  it('writes nothing when the cover is not in the cache', () => {
    expect(
      refreshCachedCoverArt(nml, [{ coverId: '042/NOPE', file: '/Music/uno.flac' }], readCover),
    ).toBe(0)
  })

  it('writes nothing when there is no cover image to write', () => {
    seed()
    expect(
      refreshCachedCoverArt(nml, [{ coverId: '042/ABC', file: '/Music/uno.flac' }], noCover),
    ).toBe(0)
    expect(readFileSync(join(cache, 'ABC000'), 'utf8')).toBe('stale thumbnail')
  })
})
