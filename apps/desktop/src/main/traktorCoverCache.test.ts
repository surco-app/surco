import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// nativeImage is Electron's, so the unit tests stub it: the sizes and the bytes written
// are what this module is responsible for, not Chromium's rasteriser.
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (buf: Buffer) => makeImage(buf.toString(), 0),
    createFromBitmap: (pixels: Buffer, { width, height }: { width: number; height: number }) => ({
      toPNG: () => Buffer.from(`png-of-bitmap:${width}x${height}:${pixels.length}`),
    }),
  },
}))

// Some builds/platforms give no usable bitmap. Flipped by the test below to pin that
// this costs only the native format, never the PNG one.
let bitmapsAvailable = true

function makeImage(source: string, size: number) {
  return {
    isEmpty: () => source === '',
    resize: ({ width }: { width: number }) => makeImage(source, width),
    toPNG: () => Buffer.from(`png:${size}`),
    toBitmap: () => {
      if (!bitmapsAvailable) throw new Error('toBitmap unavailable')
      return Buffer.alloc(size * size * 4, size & 0xff)
    },
  }
}

import {
  refreshCachedCoverArt,
  traktorCoverFile,
  traktorCoverIdOf,
  traktorCoverPng,
  traktorCoverUrl,
} from './traktorCoverCache'

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

  it('preserves Traktor native 0x08 BGRA cache format instead of writing PNG bytes', () => {
    for (const variant of ['000', '001', '002']) {
      writeFileSync(join(cache, `ABC${variant}`), Buffer.from([0x08, 1, 0, 0, 0, 1, 0, 0, 0, 0]))
    }
    expect(
      refreshCachedCoverArt(nml, [{ coverId: '042/ABC', file: '/Music/uno.flac' }], readCover),
    ).toBe(3)
    const native125 = readFileSync(join(cache, 'ABC000'))
    expect(native125[0]).toBe(0x08)
    expect(native125.readUInt32LE(1)).toBe(125)
    expect(native125.readUInt32LE(5)).toBe(125)
    expect(native125.length).toBe(9 + 125 * 125 * 4)
  })

  // Rendering the two formats used to share one try/catch, so a build whose toBitmap
  // throws discarded the PNG along with the bitmap and refreshed nothing at all — the
  // native-format support silently disabling the case that already worked. The formats
  // have to fail independently.
  it('still refreshes a PNG cache when no bitmap can be rendered', () => {
    bitmapsAvailable = false
    try {
      for (const variant of ['000', '001', '002']) {
        writeFileSync(join(cache, `ABC${variant}`), 'stale thumbnail')
      }

      const written = refreshCachedCoverArt(
        nml,
        [{ coverId: '042/ABC', file: '/Music/uno.flac' }],
        readCover,
      )

      expect(written).toBe(3)
      expect(readFileSync(join(cache, 'ABC000'), 'utf8')).toBe('png:125')
    } finally {
      bitmapsAvailable = true
    }
  })

  // The other half: a native thumbnail must not be overwritten with PNG bytes Traktor
  // would ignore, which would cost the old picture and give nothing back.
  it('leaves a native thumbnail alone when no bitmap can be rendered', () => {
    bitmapsAvailable = false
    try {
      const native = Buffer.from([0x08, 1, 0, 0, 0, 1, 0, 0, 0, 0])
      for (const variant of ['000', '001', '002']) {
        writeFileSync(join(cache, `ABC${variant}`), native)
      }

      const written = refreshCachedCoverArt(
        nml,
        [{ coverId: '042/ABC', file: '/Music/uno.flac' }],
        readCover,
      )

      expect(written).toBe(0)
      expect(readFileSync(join(cache, 'ABC000'))).toEqual(native)
    } finally {
      bitmapsAvailable = true
    }
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

// A Traktor row had no art to show until its file was read in full, so every one of a big
// collection took the full read (cover and all, three times the cost of the light one).
// Traktor keeps a thumbnail of each cover in its own cache; the list paints from that.
describe('the thumbnail Traktor already keeps', () => {
  let dir: string
  let nml: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'surco-cover-thumb-'))
    nml = join(dir, 'Traktor 4.5.1', 'collection.nml')
    mkdirSync(join(dir, 'Traktor 4.5.1'), { recursive: true })
    writeFileSync(nml, '<NML/>')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const keep = (root: string, bytes: Buffer) => {
    mkdirSync(join(root, 'Coverart', '042'), { recursive: true })
    writeFileSync(join(root, 'Coverart', '042', 'ABCDEF000'), bytes)
  }

  it('finds the largest thumbnail beside the collection or one folder above it', () => {
    keep(dir, Buffer.from('x'))

    expect(traktorCoverFile(nml, '042/ABCDEF')).toBe(join(dir, 'Coverart', '042', 'ABCDEF000'))
    expect(traktorCoverFile(nml, '042/MISSING')).toBeNull()
  })

  it('never reaches outside the cache for an id the collection file made up', () => {
    writeFileSync(join(dir, 'secret000'), 'x')

    expect(traktorCoverFile(nml, '../../secret')).toBeNull()
    expect(traktorCoverFile(nml, '042/../../../secret')).toBeNull()
  })

  it("turns Traktor's own pixel format into a picture the list can show", () => {
    const header = Buffer.alloc(9)
    header[0] = 0x08
    header.writeUInt32LE(2, 1)
    header.writeUInt32LE(3, 5)
    keep(dir, Buffer.concat([header, Buffer.alloc(2 * 3 * 4, 7)]))

    const png = traktorCoverPng(join(dir, 'Coverart', '042', 'ABCDEF000'))

    expect(png?.toString()).toBe('png-of-bitmap:2x3:24')
  })

  it('hands a thumbnail Traktor wrote as PNG over as it is', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('rest'),
    ])
    keep(dir, png)

    expect(traktorCoverPng(join(dir, 'Coverart', '042', 'ABCDEF000'))).toEqual(png)
  })

  it('shows nothing for a thumbnail cut short, rather than a garbled picture', () => {
    const header = Buffer.alloc(9)
    header[0] = 0x08
    header.writeUInt32LE(125, 1)
    header.writeUInt32LE(125, 5)
    keep(dir, Buffer.concat([header, Buffer.alloc(100)]))

    expect(traktorCoverPng(join(dir, 'Coverart', '042', 'ABCDEF000'))).toBeNull()
  })

  it('names a cover by an address only this cache answers, and reads the id back from it', () => {
    const url = traktorCoverUrl('042/ABC DEF')

    expect(traktorCoverIdOf(url)).toBe('042/ABC DEF')
    expect(traktorCoverIdOf('surco://cover/abc.jpg')).toBeNull()
    expect(traktorCoverIdOf('https://example.com/042/ABC')).toBeNull()
  })
})
