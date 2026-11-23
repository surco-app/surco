import { describe, expect, it } from 'vitest'
import { rawFramesOf } from '../shared/serato'
import { parseSeratoDatabase } from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'
import {
  type NewSeratoTrack,
  seratoDatabaseHas,
  seratoFileType,
  withSeratoTrackAdded,
  withSeratoTrackFields,
  withSeratoTrackRepointed,
} from './seratoDatabaseWrite'

const PRAY_PFIL = 'Users/vicent/Music/Serato Pruebas/Pray.aiff'
const present = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}
const raw = (hex: string) =>
  Uint8Array.from(present(hex.match(/../g)).map((h) => Number.parseInt(h, 16)))
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

const entryFrames = (body: Uint8Array) => present(rawFramesOf(body))

function entries(db: Uint8Array) {
  return entryFrames(db).filter((f) => f.tag === 'otrk')
}

const subframeTags = (db: Uint8Array) =>
  entryFrames(present(entries(db).at(-1)).body).map((f) => f.tag)
const lastEntryField = (db: Uint8Array, tag: string) =>
  entryFrames(present(entries(db).at(-1)).body).find((f) => f.tag === tag)?.body

describe('withSeratoTrackFields', () => {
  it('changes only the title of the entry with that pfil, byte for byte elsewhere', () => {
    const db = concat([VRSN, REAL_ENTRY, OTHER_ENTRY])
    const out = present(withSeratoTrackFields(db, PRAY_PFIL, { tsng: 'Pray (Edit)' }))
    expect(parseSeratoDatabase(out)[0].title).toBe('Pray (Edit)')
    expect(out.subarray(-OTHER_ENTRY.length)).toEqual(OTHER_ENTRY)
    expect(
      withSeratoTrackFields(out, PRAY_PFIL, { tsng: 'Pray (W.I.P. In The Church Mix)' }),
    ).toEqual(db)
  })

  it('keeps every unknown field of the entry, in its order', () => {
    const out = present(
      withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, { tgen: 'House' }),
    )
    expect(subframeTags(out)).toEqual(subframeTags(concat([VRSN, REAL_ENTRY])))
  })

  it('adds a field the entry lacked at the end of the entry', () => {
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'a.mp3' })])
    expect(subframeTags(present(withSeratoTrackFields(db, 'a.mp3', { talb: 'X' })))).toEqual([
      'ttyp',
      'pfil',
      'talb',
    ])
  })

  it('ignores a field passed as undefined', () => {
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'a.mp3', tsng: 'Old' })])
    const out = present(withSeratoTrackFields(db, 'a.mp3', { tsng: 'X', tart: undefined }))
    expect(subframeTags(out)).toEqual(['ttyp', 'pfil', 'tsng'])
    expect(parseSeratoDatabase(out)[0].title).toBe('X')
  })

  it('writes an empty string as a zero length frame', () => {
    const out = present(withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, { talb: '' }))
    expect(parseSeratoDatabase(out)[0].album).toBe('')
    expect(subframeTags(out)).toContain('talb')
  })

  it('matches a pfil written in NFD with one asked in NFC', () => {
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'Música/a.mp3'.normalize('NFD') })])
    expect(seratoDatabaseHas(db, 'Música/a.mp3'.normalize('NFC'))).toBe(true)
    const out = present(withSeratoTrackFields(db, 'Música/a.mp3', { tsng: 'T' }))
    expect(lastEntryField(out, 'pfil')).toEqual(utf16be('Música/a.mp3'.normalize('NFD')))
  })

  it('never touches pfil', () => {
    const out = present(
      withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, {
        tsng: 'x',
        tart: 'y',
        talb: 'z',
        tgen: 'w',
      }),
    )
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
    const out = present(withSeratoTrackAdded(concat([VRSN, REAL_ENTRY]), NEW))
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
    expect(
      subframeTags(present(withSeratoTrackAdded(VRSN, { ...NEW, album: '', genre: '' }))),
    ).toEqual(['ttyp', 'pfil', 'tsng', 'tart', 'tadd', 'uadd'])
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

describe('withSeratoTrackRepointed', () => {
  const MP3_PFIL = 'Users/vicent/Music/other.mp3'
  const fieldsOf = (db: Uint8Array, at: number) =>
    entryFrames(present(entries(db)[at]).body).map((f) => ({ tag: f.tag, raw: f.raw }))
  const textOf = (db: Uint8Array, at: number, tag: string) =>
    new TextDecoder('utf-16be').decode(
      present(entryFrames(present(entries(db)[at]).body).find((f) => f.tag === tag)).body,
    )

  // Serato keeps BPM, key, added date and plays across the re-import only because they ride in
  // database V2 (measured 04/11): a rewrite that lost any of them would cost more than the stars.
  it('changes only the path and the type, leaving tbpm, tkey, uadd and utpc as they were', () => {
    const db = concat([VRSN, REAL_ENTRY])
    const out = present(
      withSeratoTrackRepointed(db, PRAY_PFIL, 'Users/vicent/Music/Serato Pruebas/Pray.flac'),
    )
    const before = fieldsOf(db, 0)
    const after = fieldsOf(out, 0)
    expect(after.map((f) => f.tag)).toEqual(before.map((f) => f.tag))
    for (const [i, f] of before.entries()) {
      if (f.tag === 'pfil' || f.tag === 'ttyp') continue
      expect(after[i].raw).toEqual(f.raw)
    }
    expect(textOf(out, 0, 'pfil')).toBe('Users/vicent/Music/Serato Pruebas/Pray.flac')
    expect(out.subarray(0, VRSN.length)).toEqual(VRSN)
  })

  // Serato decides how to read the file from ttyp, so a path that says .wav under 'mp3' would
  // import as a broken track.
  it('writes the new type Serato expects when the format changes', () => {
    const out = present(
      withSeratoTrackRepointed(
        concat([VRSN, OTHER_ENTRY]),
        MP3_PFIL,
        'Users/vicent/Music/other.wav',
      ),
    )
    expect(textOf(out, 0, 'ttyp')).toBe('wave')
    expect(textOf(out, 0, 'pfil')).toBe('Users/vicent/Music/other.wav')
  })

  it('keeps the type bytes when the format is the same', () => {
    const db = concat([VRSN, OTHER_ENTRY])
    const out = present(withSeratoTrackRepointed(db, MP3_PFIL, 'Users/vicent/Music/renamed.mp3'))
    expect(fieldsOf(out, 0)[0]).toEqual(fieldsOf(db, 0)[0])
  })

  // Serato matches paths byte for byte after its own normalization: rewriting an NFD entry in NFC
  // would make it look like a different file and Serato would drop it as missing.
  it('keeps the decomposed form the database stored the path in', () => {
    const nfd = 'Users/vicent/Música/Canción.mp3'.normalize('NFD')
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: nfd, tsng: 'x' })])
    const out = present(
      withSeratoTrackRepointed(
        db,
        'Users/vicent/Música/Canción.mp3'.normalize('NFC'),
        'Users/vicent/Música/Canción.wav'.normalize('NFC'),
      ),
    )
    expect(textOf(out, 0, 'pfil')).toBe('Users/vicent/Música/Canción.wav'.normalize('NFD'))
  })

  it('keeps the composed form when the database stored it composed', () => {
    const nfc = 'Users/vicent/Música/Canción.mp3'.normalize('NFC')
    const db = concat([VRSN, track({ ttyp: 'mp3', pfil: nfc })])
    const out = present(
      withSeratoTrackRepointed(db, nfc, 'Users/vicent/Música/Canción.wav'.normalize('NFD')),
    )
    expect(textOf(out, 0, 'pfil')).toBe('Users/vicent/Música/Canción.wav'.normalize('NFC'))
  })

  it('leaves every other track untouched', () => {
    const db = concat([VRSN, OTHER_ENTRY, REAL_ENTRY, OTHER_ENTRY])
    const out = present(
      withSeratoTrackRepointed(db, PRAY_PFIL, 'Users/vicent/Music/Serato Pruebas/Pray.wav'),
    )
    const before = entries(db)
    const after = entries(out)
    expect(after).toHaveLength(3)
    expect(after[0].raw).toEqual(before[0].raw)
    expect(after[2].raw).toEqual(before[2].raw)
    expect(after[1].raw).not.toEqual(before[1].raw)
  })

  it('answers null for a path the database does not hold', () => {
    expect(withSeratoTrackRepointed(concat([VRSN, REAL_ENTRY]), 'nope.mp3', 'nope.wav')).toBeNull()
  })

  it('answers null for a database it cannot read whole', () => {
    expect(withSeratoTrackRepointed(Uint8Array.from([1, 2, 3]), PRAY_PFIL, 'a.wav')).toBeNull()
  })
})
