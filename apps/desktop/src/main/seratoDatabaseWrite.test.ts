import { describe, expect, it } from 'vitest'
import { parseSeratoDatabase } from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import {
  type NewSeratoTrack,
  seratoDatabaseHas,
  seratoFileType,
  withSeratoTrackAdded,
  withSeratoTrackFields,
} from './seratoDatabaseWrite'

const PRAY_PFIL = 'Users/vicent/Music/Serato Pruebas/Pray.aiff'
const raw = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => Number.parseInt(h, 16)))
const rawFrame = (tag: string, hex: string) => frame(tag, raw(hex))

const VRSN = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))
const REAL_ENTRY = track(
  {
    ttyp: 'aiff',
    pfil: PRAY_PFIL,
    tsng: 'Pray (W.I.P. In The Church Mix)',
    tart: 'Tina Cousins',
    talb: 'Pray',
    tgen: 'Electronic',
    tlen: '07:08.25',
    tsiz: '72.0MB',
    tbit: '1411.2kbps',
    tsmp: '44.1k',
    tbpm: '134.00',
    tcom: '℗ 1998 Zomba Records Ltd.',
    ttyr: '1998',
    tadd: '1793688116',
    tkey: 'Ebm',
  },
  [
    rawFrame('uadd', '6ae98234'),
    rawFrame('utkn', '00000001'),
    rawFrame('utme', '6ae98e3f'),
    rawFrame('ufsb', '0480cc1a'),
    rawFrame('utpc', '00000000'),
    ...[
      'bhrt',
      'bmis',
      'bply',
      'blop',
      'bitu',
      'bovc',
      'bcrt',
      'biro',
      'bwlb',
      'bwll',
      'buns',
      'bbgl',
      'bkrk',
    ].map((tag) => rawFrame(tag, tag === 'bply' || tag === 'bovc' ? '01' : '00')),
  ],
)
const OTHER_ENTRY = track({ ttyp: 'mp3', pfil: 'Users/vicent/Music/other.mp3', tsng: 'Other' }, [
  rawFrame('uadd', '6ae98235'),
])
const NEW: NewSeratoTrack = {
  pfil: 'Users/vicent/Music/new.flac',
  type: 'flac',
  title: 'New',
  artist: 'Artist',
  album: 'Album',
  genre: 'House',
  addedAt: 1793688116,
}

function entryFrames(body: Uint8Array) {
  const out: { tag: string; body: Uint8Array }[] = []
  let at = 0
  while (at < body.length) {
    const length = new DataView(body.buffer, body.byteOffset + at + 4, 4).getUint32(0)
    out.push({
      tag: String.fromCharCode(...body.subarray(at, at + 4)),
      body: body.subarray(at + 8, at + 8 + length),
    })
    at += 8 + length
  }
  return out
}

function entries(db: Uint8Array) {
  return entryFrames(db).filter((f) => f.tag === 'otrk')
}

const subframeTags = (db: Uint8Array) => entryFrames(entries(db).at(-1)!.body).map((f) => f.tag)
const lastEntryField = (db: Uint8Array, tag: string) =>
  entryFrames(entries(db).at(-1)!.body).find((f) => f.tag === tag)!.body

describe('withSeratoTrackFields', () => {
  it('changes only the title of the entry with that pfil, byte for byte elsewhere', () => {
    const db = concat([VRSN, REAL_ENTRY, OTHER_ENTRY])
    const out = withSeratoTrackFields(db, PRAY_PFIL, { tsng: 'Pray (Edit)' })!
    expect(parseSeratoDatabase(out)[0].title).toBe('Pray (Edit)')
    expect(out.subarray(-OTHER_ENTRY.length)).toEqual(OTHER_ENTRY)
    expect(
      withSeratoTrackFields(out, PRAY_PFIL, { tsng: 'Pray (W.I.P. In The Church Mix)' }),
    ).toEqual(db)
  })

  it('keeps every unknown field of the entry, in its order', () => {
    const out = withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, { tgen: 'House' })!
    expect(subframeTags(out)).toEqual(subframeTags(concat([VRSN, REAL_ENTRY])))
  })

  it('adds a field the entry lacked at the end of the entry', () => {
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'a.mp3' })])
    expect(subframeTags(withSeratoTrackFields(db, 'a.mp3', { talb: 'X' })!)).toEqual([
      'ttyp',
      'pfil',
      'talb',
    ])
  })

  it('writes an empty string as a zero length frame', () => {
    const out = withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, { talb: '' })!
    expect(parseSeratoDatabase(out)[0].album).toBe('')
    expect(subframeTags(out)).toContain('talb')
  })

  it('matches a pfil written in NFD with one asked in NFC', () => {
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'Música/a.mp3'.normalize('NFD') })])
    expect(seratoDatabaseHas(db, 'Música/a.mp3'.normalize('NFC'))).toBe(true)
    expect(withSeratoTrackFields(db, 'Música/a.mp3', { tsng: 'T' })).not.toBeNull()
  })

  it('never touches pfil', () => {
    const out = withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, {
      tsng: 'x',
      tart: 'y',
      talb: 'z',
      tgen: 'w',
    })!
    expect(parseSeratoDatabase(out)[0].path).toBe(PRAY_PFIL)
  })

  it('answers null for a track that is not there and for a truncated database', () => {
    expect(withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), 'nope.mp3', { tsng: 'x' })).toBeNull()
    const cut = concat([VRSN, REAL_ENTRY]).subarray(0, -2)
    expect(withSeratoTrackFields(cut, PRAY_PFIL, { tsng: 'x' })).toBeNull()
    expect(withSeratoTrackAdded(cut, NEW)).toBeNull()
  })
})

describe('withSeratoTrackAdded', () => {
  it('appends a new entry Serato reads, with the added time as text and as u32', () => {
    const out = withSeratoTrackAdded(concat([VRSN, REAL_ENTRY]), NEW)!
    expect(out.subarray(0, VRSN.length + REAL_ENTRY.length)).toEqual(concat([VRSN, REAL_ENTRY]))
    expect(parseSeratoDatabase(out)[1]).toMatchObject({
      path: NEW.pfil,
      title: NEW.title,
      addedAt: 1793688116,
    })
    expect(lastEntryField(out, 'uadd')).toEqual(Uint8Array.from([0x6a, 0xe9, 0x82, 0x34]))
    expect(subframeTags(out).slice(-8)).toEqual([
      'ttyp',
      'pfil',
      'tsng',
      'tart',
      'talb',
      'tgen',
      'tadd',
      'uadd',
    ])
  })

  it('leaves out empty text fields of a new entry', () => {
    expect(subframeTags(withSeratoTrackAdded(VRSN, { ...NEW, album: '', genre: '' })!)).toEqual([
      'ttyp',
      'pfil',
      'tsng',
      'tart',
      'tadd',
      'uadd',
    ])
  })
})

describe('seratoFileType', () => {
  it.each([
    ['a.MP3', 'mp3'],
    ['a.wav', 'wave'],
    ['a.aif', 'aiff'],
    ['a.aiff', 'aiff'],
    ['a.flac', 'flac'],
    ['a.m4a', 'quicktime'],
    ['a.mp4', 'quicktime'],
    ['a.ogg', null],
  ])('types %s as %s', (path, type) => {
    expect(seratoFileType(path)).toBe(type)
  })
})
