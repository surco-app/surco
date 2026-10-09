import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (buf: Buffer) => {
      const [w, h] = buf.toString().split('x').map(Number)
      return makeImage(w || 0, h || 0)
    },
  },
}))

function makeImage(width: number, height: number) {
  return {
    isEmpty: () => width === 0,
    getSize: () => ({ width, height }),
    resize: (size: { width: number; height: number }) => makeImage(size.width, size.height),
    toJPEG: () => Buffer.from(`jpeg:${width}x${height}`),
  }
}

import { renderArtwork, stageArtwork } from './rekordboxArtwork'

const UUID = '992bdc59-d0a3-4e3a-8c11-cce595ba93b1'

let share: string

beforeEach(() => {
  share = join(mkdtempSync(join(tmpdir(), 'surco-rbart-')), 'share')
  mkdirSync(share)
})

// rekordbox keeps three JPEGs per cover and each view reads its own: measured on a real
// install, the big one never passes 800 px and the others are 240 and 80. Writing only the
// big one would leave the browser and the deck views on the old picture.
describe('renderArtwork', () => {
  it('renders the three sizes rekordbox reads', () => {
    const rendered = renderArtwork(Buffer.from('1200x1200'))
    expect(
      rendered && Object.fromEntries([...rendered].map(([k, v]) => [k, v.toString()])),
    ).toEqual({
      'artwork.jpg': 'jpeg:800x800',
      'artwork_m.jpg': 'jpeg:240x240',
      'artwork_s.jpg': 'jpeg:80x80',
    })
  })

  it('never enlarges a small cover', () => {
    const rendered = renderArtwork(Buffer.from('500x500'))
    expect(rendered?.get('artwork.jpg')?.toString()).toBe('jpeg:500x500')
  })

  it('keeps the shape of a cover that is not square', () => {
    const rendered = renderArtwork(Buffer.from('1600x1200'))
    expect(rendered?.get('artwork.jpg')?.toString()).toBe('jpeg:800x600')
  })

  // An unreadable cover must leave the artwork rekordbox already shows, not blank it.
  it('gives nothing for an image it cannot read', () => {
    expect(renderArtwork(Buffer.from(''))).toBeNull()
  })
})

describe('stageArtwork', () => {
  it('writes the three files where rekordbox lays them out', () => {
    const rendered = renderArtwork(Buffer.from('600x600'))
    const staged = stageArtwork(share, null, rendered as Map<string, Buffer>, () => UUID)
    expect(staged?.imagePath).toBe(
      `/PIONEER/Artwork/992/bdc59-d0a3-4e3a-8c11-cce595ba93b1/artwork.jpg`,
    )
    const folder = join(share, 'PIONEER/Artwork/992/bdc59-d0a3-4e3a-8c11-cce595ba93b1')
    expect(readdirSync(folder).sort()).toEqual(['artwork.jpg', 'artwork_m.jpg', 'artwork_s.jpg'])
  })

  // Every tags-only update would otherwise leave one more folder behind for a picture
  // that did not change.
  it('does nothing when rekordbox already has this exact artwork', () => {
    const rendered = renderArtwork(Buffer.from('600x600')) as Map<string, Buffer>
    const first = stageArtwork(share, null, rendered, () => UUID)
    const again = stageArtwork(share, first?.imagePath ?? null, rendered, () => 'aaa-other')
    expect(again).toBeNull()
    expect(existsSync(join(share, 'PIONEER/Artwork/aaa'))).toBe(false)
  })

  // The collection backup still points at the old picture; restoring it must find it there.
  it('leaves the previous artwork on disk', () => {
    const old = join(share, 'PIONEER/Artwork/52c/55a05')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'artwork.jpg'), 'old')
    const rendered = renderArtwork(Buffer.from('600x600')) as Map<string, Buffer>
    const staged = stageArtwork(
      share,
      '/PIONEER/Artwork/52c/55a05/artwork.jpg',
      rendered,
      () => UUID,
    )
    expect(staged).not.toBeNull()
    expect(readFileSync(join(old, 'artwork.jpg'), 'utf8')).toBe('old')
  })

  // ImagePath comes out of the user's collection: a value that climbs out of the share
  // folder is compared against nothing rather than read from wherever it points.
  it('does not read an artwork path outside the share folder', () => {
    const outside = join(share, '..', 'secret.jpg')
    const rendered = renderArtwork(Buffer.from('600x600')) as Map<string, Buffer>
    writeFileSync(outside, rendered.get('artwork.jpg') as Buffer)
    expect(stageArtwork(share, '/../secret.jpg', rendered, () => UUID)).not.toBeNull()
  })
})
