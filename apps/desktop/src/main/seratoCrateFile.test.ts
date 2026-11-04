import { describe, expect, it } from 'vitest'
import { buildSeratoCrate } from '../shared/serato'
import {
  crateFamily,
  crateIdOf,
  crateTrackPaths,
  parseSeratoLinkId,
  renamedCrateId,
  seratoLinkId,
  seratoPathOn,
  seratoRootOf,
  validCrateName,
  withCrateTracks,
} from './seratoCrateFile'
import { concat, frame, utf16be } from './seratoDatabaseFixture'

const DIR = 'Users/vicent/Music/Serato Pruebas/Medida Q'
const Q_XING = `${DIR}/Q mp3 Xing.mp3`
const Q_WAV = `${DIR}/Q wav.wav`

const column = (name: string, width: string) =>
  frame('ovct', concat([frame('tvcn', utf16be(name)), frame('tvcw', utf16be(width))]))
const otrk = (path: string) => frame('otrk', frame('ptrk', utf16be(path)))

const HEAD = concat([
  frame('vrsn', utf16be('1.0/Serato ScratchLive Crate')),
  column('song', '250'),
  column('artist', '250'),
  column('bpm', '30'),
  column('key', '30'),
  column('album', '250'),
  column('length', '250'),
  column('comment', '250'),
])
const COLUMNS_END = HEAD.length
const MEDIDA_Q = concat([
  HEAD,
  otrk(Q_XING),
  otrk(`${DIR}/Q mp3 sin Xing.mp3`),
  otrk(Q_WAV),
  otrk(`${DIR}/Q m4a.m4a`),
])

describe('serato crate files', () => {
  it('rewrites a real crate with the same tracks into the same bytes', () => {
    expect(
      withCrateTracks(
        MEDIDA_Q,
        [0, 1, 2, 3].map((keep) => ({ keep })),
      ),
    ).toEqual(MEDIDA_Q)
  })

  it('reorders and drops tracks while keeping version and columns in place', () => {
    const out = withCrateTracks(MEDIDA_Q, [{ keep: 2 }, { keep: 0 }]) ?? new Uint8Array()
    expect(crateTrackPaths(out)).toEqual([Q_WAV, Q_XING])
    expect(out.subarray(0, COLUMNS_END)).toEqual(MEDIDA_Q.subarray(0, COLUMNS_END))
  })

  it('appends a new track after the columns of an empty crate', () => {
    expect(
      crateTrackPaths(
        withCrateTracks(buildSeratoCrate([]), [{ path: 'Users/dj/a.mp3' }]) ?? new Uint8Array(),
      ),
    ).toEqual(['Users/dj/a.mp3'])
  })

  it('keeps unknown frames that sit after the tracks', () => {
    const crate = concat([MEDIDA_Q, frame('zzzz', new Uint8Array([1, 2]))])
    expect(withCrateTracks(crate, [{ keep: 1 }])?.subarray(-10)).toEqual(
      frame('zzzz', new Uint8Array([1, 2])),
    )
  })

  it('never rewrites a truncated crate', () => {
    const cut = MEDIDA_Q.subarray(0, MEDIDA_Q.length - 3)
    expect(crateTrackPaths(cut)).toBeNull()
    expect(withCrateTracks(cut, [{ keep: 0 }])).toBeNull()
  })

  it('treats trailing bytes too short for a frame header as truncation', () => {
    const tail = concat([MEDIDA_Q, new Uint8Array([1, 2, 3])])
    expect(crateTrackPaths(tail)).toBeNull()
    expect(withCrateTracks(tail, [{ keep: 0 }])).toBeNull()
  })

  it('refuses a keep that points past the tracks', () => {
    expect(withCrateTracks(MEDIDA_Q, [{ keep: 4 }])).toBeNull()
    expect(withCrateTracks(MEDIDA_Q, [{ keep: -1 }])).toBeNull()
  })

  it('reports an empty path for a track without ptrk', () => {
    expect(crateTrackPaths(concat([HEAD, frame('otrk', new Uint8Array())]))).toEqual([''])
  })

  it('refuses empty names and names with %% or a slash', () => {
    expect(['', '  ', 'a%%b', 'a/b'].map(validCrateName)).toEqual([false, false, false, false])
    expect(validCrateName('Techno 2026')).toBe(true)
  })

  it('builds crate ids from the parent id', () => {
    expect(crateIdOf('root', 'A')).toBe('A')
    expect(crateIdOf('A', 'B')).toBe('A%%B')
  })

  it('finds a crate and every subcrate below it, not siblings sharing a prefix', () => {
    expect(crateFamily(['A', 'A%%B', 'A%%B%%C', 'AB'], 'A').sort()).toEqual([
      'A',
      'A%%B',
      'A%%B%%C',
    ])
  })

  it('renames the segment of the renamed crate in a descendant id', () => {
    expect(renamedCrateId('A%%B%%C', 'A%%B', 'X')).toBe('A%%X%%C')
    expect(renamedCrateId('A%%B', 'A%%B', 'X')).toBe('A%%X')
    expect(renamedCrateId('B', 'B', 'X')).toBe('X')
  })

  it('places a file on its own volume root', () => {
    const roots = [
      { dir: '/Users/dj/Music/_Serato_', root: '/' },
      { dir: '/Volumes/Gig/_Serato_', root: '/Volumes/Gig' },
    ]
    expect(seratoRootOf('/Volumes/gig/t.mp3', roots)).toBe(roots[1])
    expect(seratoRootOf('/Users/dj/t.mp3', roots)).toBe(roots[0])
    expect(seratoPathOn('/Volumes/Gig/Tracks/t.mp3', roots[1])).toBe('Tracks/t.mp3')
    expect(seratoPathOn('/Users/dj/t.mp3', roots[0])).toBe('Users/dj/t.mp3')
    expect(seratoRootOf('/Volumes/Other/t.mp3', roots)).toBeNull()
  })

  it('reads back a link id with the crate file it names, and nothing from anything else', () => {
    const file = '/Volumes/Gig: B/_Serato_/Subcrates/A%%B.crate'
    expect(parseSeratoLinkId(seratoLinkId(3, file))).toEqual({ index: 3, crateFile: file })
    expect(parseSeratoLinkId('fri:0:HD/:m/:a.mp3')).toBeNull()
    expect(parseSeratoLinkId('-1:/a.crate')).toBeNull()
    expect(parseSeratoLinkId('7')).toBeNull()
  })
})
