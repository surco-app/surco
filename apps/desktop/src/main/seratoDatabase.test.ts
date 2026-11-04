import { describe, expect, it } from 'vitest'
import {
  crateTree,
  parseSeratoCrate,
  parseSeratoDatabase,
  repointSeratoCrate,
  repointSeratoDatabase,
  seratoDatabaseTruncated,
} from './seratoDatabase'
import { concat, frame, track, utf16be } from './seratoDatabaseFixture'

const DATABASE_V2 =
  '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'

const PRUEBAS_CRATE =
  'dnJzbgAAADgAMQAuADAALwBTAGUAcgBhAHQAbwAgAFMAYwByAGEAdABjAGgATABpAHYAZQAgAEMAcgBhAHQAZW92Y3QAAAAedHZjbgAAAAgAcwBvAG4AZ3R2Y3cAAAAGADIANQAwb3ZjdAAAACJ0dmNuAAAADABhAHIAdABpAHMAdHR2Y3cAAAAGADIANQAwb3ZjdAAAABp0dmNuAAAABgBiAHAAbXR2Y3cAAAAEADMAMG92Y3QAAAAadHZjbgAAAAYAawBlAHl0dmN3AAAABAAzADBvdmN0AAAAIHR2Y24AAAAKAGEAbABiAHUAbXR2Y3cAAAAGADIANQAwb3ZjdAAAACJ0dmNuAAAADABsAGUAbgBnAHQAaHR2Y3cAAAAGADIANQAwb3ZjdAAAACR0dmNuAAAADgBjAG8AbQBtAGUAbgB0dHZjdwAAAAYAMgA1ADBvdHJrAAAAXHB0cmsAAABUAFUAcwBlAHIAcwAvAHYAaQBjAGUAbgB0AC8ATQB1AHMAaQBjAC8AUwBlAHIAYQB0AG8AIABQAHIAdQBlAGIAYQBzAC8AUAByAGEAeQAuAG0AcAAzb3RyawAAAF5wdHJrAAAAVgBVAHMAZQByAHMALwB2AGkAYwBlAG4AdAAvAE0AdQBzAGkAYwAvAFMAZQByAGEAdABvACAAUAByAHUAZQBiAGEAcwAvAFAAcgBhAHkALgBhAGkAZgBmb3RyawAAAFxwdHJrAAAAVABVAHMAZQByAHMALwB2AGkAYwBlAG4AdAAvAE0AdQBzAGkAYwAvAFMAZQByAGEAdABvACAAUAByAHUAZQBiAGEAcwAvAFAAcgBhAHkALgBtADQAYW90cmsAAABecHRyawAAAFYAVQBzAGUAcgBzAC8AdgBpAGMAZQBuAHQALwBNAHUAcwBpAGMALwBTAGUAcgBhAHQAbwAgAFAAcgB1AGUAYgBhAHMALwBQAHIAYQB5AC4AZgBsAGEAY290cmsAAABccHRyawAAAFQAVQBzAGUAcgBzAC8AdgBpAGMAZQBuAHQALwBNAHUAcwBpAGMALwBTAGUAcgBhAHQAbwAgAFAAcgB1AGUAYgBhAHMALwBQAHIAYQB5AC4AdwBhAHY='

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const VERSION = frame('vrsn', utf16be('2.0/Serato Scratch LIVE Database'))

const FULL = {
  pfil: 'Volumes/Disco/Música/Uno.mp3',
  tsng: 'Uno',
  tart: 'Artista',
  talb: 'Álbum',
  tgen: 'House',
  tbpm: '124.00',
  tkey: 'Am',
  tadd: '1700000000',
}

const PRAY = (ext: string) => ({
  path: `Users/vicent/Music/Serato Pruebas/Pray.${ext}`,
  title: 'Pray (W.I.P. In The Church Mix)',
  artist: 'Tina Cousins',
  album: 'Pray',
  genre: 'Electronic',
  bpm: '134.00',
  key: 'Ebm',
  addedAt: 1793688116,
})

describe('parseSeratoDatabase', () => {
  it('reads each track with its path and the fields the tab shows, empty when Serato left one out', () => {
    const db = concat([VERSION, track(FULL), track({ pfil: 'Users/dj/Solo.wav' })])
    expect(parseSeratoDatabase(db)).toEqual([
      {
        path: 'Volumes/Disco/Música/Uno.mp3',
        title: 'Uno',
        artist: 'Artista',
        album: 'Álbum',
        genre: 'House',
        bpm: '124.00',
        key: 'Am',
        addedAt: 1700000000,
      },
      {
        path: 'Users/dj/Solo.wav',
        title: '',
        artist: '',
        album: '',
        genre: '',
        bpm: '',
        key: '',
        addedAt: null,
      },
    ])
  })

  it('reads the database Serato DJ Pro 5 wrote', () => {
    expect(parseSeratoDatabase(bytes(DATABASE_V2))).toEqual(
      ['mp3', 'aiff', 'm4a', 'flac', 'wav'].map(PRAY),
    )
  })

  it('skips a tag it does not know inside a track and still reads the rest', () => {
    const unknown = frame('zzzz', Uint8Array.from([1, 2, 3]))
    const db = concat([VERSION, frame('ozzz', new Uint8Array(4)), track(FULL, [unknown])])
    expect(parseSeratoDatabase(db).map((t) => [t.path, t.key])).toEqual([[FULL.pfil, 'Am']])
  })

  it('keeps the whole tracks before a cut and never throws on truncated bytes', () => {
    const db = concat([VERSION, track(FULL), track({ pfil: 'Users/dj/Solo.wav' })])
    expect(parseSeratoDatabase(db.subarray(0, db.length - 3)).map((t) => t.path)).toEqual([
      FULL.pfil,
    ])
    const real = bytes(DATABASE_V2)
    for (let n = 0; n <= real.length; n += 13)
      expect(() => parseSeratoDatabase(real.subarray(0, n))).not.toThrow()
  })

  it('says when the bytes end inside a frame, so a half-written database is not read as the whole library', () => {
    const db = concat([VERSION, track(FULL), track({ pfil: 'Users/dj/Solo.wav' })])
    expect(seratoDatabaseTruncated(db)).toBe(false)
    expect(seratoDatabaseTruncated(db.subarray(0, db.length - 3))).toBe(true)
    expect(seratoDatabaseTruncated(concat([db, Uint8Array.from([0x6f, 0x74])]))).toBe(true)
    expect(seratoDatabaseTruncated(bytes(DATABASE_V2))).toBe(false)
  })

  it('ignores a track without a path, which Serato could not open either', () => {
    expect(parseSeratoDatabase(concat([VERSION, track({ tsng: 'Sin ruta' })]))).toEqual([])
  })
})

describe('parseSeratoCrate', () => {
  it('lists the crate tracks in the order the DJ arranged them', () => {
    expect(parseSeratoCrate(bytes(PRUEBAS_CRATE))).toEqual(
      ['mp3', 'aiff', 'm4a', 'flac', 'wav'].map(
        (ext) => `Users/vicent/Music/Serato Pruebas/Pray.${ext}`,
      ),
    )
  })

  it('reads the tracks before a cut or an unknown tag without throwing', () => {
    const crate = concat([
      frame('vrsn', utf16be('1.0/Serato ScratchLive Crate')),
      frame('otrk', concat([frame('zzzz', new Uint8Array(2)), frame('ptrk', utf16be('a.mp3'))])),
      frame('otrk', frame('ptrk', utf16be('b.mp3'))),
    ])
    expect(parseSeratoCrate(crate)).toEqual(['a.mp3', 'b.mp3'])
    expect(parseSeratoCrate(crate.subarray(0, crate.length - 1))).toEqual(['a.mp3'])
    const real = bytes(PRUEBAS_CRATE)
    for (let n = 0; n <= real.length; n += 5)
      expect(() => parseSeratoCrate(real.subarray(0, n))).not.toThrow()
  })
})

describe('crateTree', () => {
  it('nests a subcrate under its parent by the %% in its file name', () => {
    expect(crateTree(['A.crate', 'A%%B.crate', 'c.crate'])).toEqual([
      { id: 'A', name: 'A', children: [{ id: 'A%%B', name: 'B', children: [] }] },
      { id: 'c', name: 'c', children: [] },
    ])
  })

  it('sorts crates alphabetically ignoring case, as Serato lists them', () => {
    expect(crateTree(['c.crate', 'B.crate', 'a.crate', 'B%%z.crate']).map((n) => n.id)).toEqual([
      'a',
      'B',
      'c',
    ])
    expect(
      crateTree(['B.crate', 'B%%z.crate', 'B%%Y.crate'])[0].children.map((n) => n.name),
    ).toEqual(['Y', 'z'])
  })

  it('ignores files that are not crates', () => {
    expect(crateTree(['.DS_Store', 'A.crate'])).toEqual([{ id: 'A', name: 'A', children: [] }])
  })
})

const PRUEBAS = 'Users/vicent/Music/Serato Pruebas'
const move = (from: string, to: string) => ({ from: `${PRUEBAS}/${from}`, to: `${PRUEBAS}/${to}` })
const occurrences = (haystack: Uint8Array, needle: Uint8Array) => {
  let n = 0
  for (let i = 0; i + needle.length <= haystack.length; i++)
    if (needle.every((b, j) => haystack[i + j] === b)) n++
  return n
}

describe('repointSeratoDatabase', () => {
  it('moves a renamed track to its new file and keeps every other track and field as Serato wrote it', () => {
    const before = bytes(DATABASE_V2)
    const { bytes: after, moved } = repointSeratoDatabase(before, [
      move('Pray.mp3', 'Tina Cousins - Pray.mp3'),
    ])

    expect(moved).toEqual([`${PRUEBAS}/Pray.mp3`])
    expect(parseSeratoDatabase(after).map((t) => t.path)).toEqual([
      `${PRUEBAS}/Tina Cousins - Pray.mp3`,
      ...parseSeratoDatabase(before)
        .slice(1)
        .map((t) => t.path),
    ])
    expect(
      repointSeratoDatabase(after, [move('Tina Cousins - Pray.mp3', 'Pray.mp3')]).bytes,
    ).toEqual(before)
  })

  it('names the new file type when a conversion changes the format, so Serato does not treat an AIFF as a WAV', () => {
    const before = bytes(DATABASE_V2)
    const { bytes: after } = repointSeratoDatabase(before, [
      move('Pray.wav', 'Pray converted.aiff'),
    ])

    expect(occurrences(after, frame('ttyp', utf16be('aiff')))).toBe(
      occurrences(before, frame('ttyp', utf16be('aiff'))) + 1,
    )
    expect(repointSeratoDatabase(after, [move('Pray converted.aiff', 'Pray.wav')]).bytes).toEqual(
      before,
    )
  })

  it('leaves the database untouched for a file Serato does not hold', () => {
    const before = bytes(DATABASE_V2)
    const { bytes: after, moved } = repointSeratoDatabase(before, [move('Other.mp3', 'New.mp3')])

    expect(moved).toEqual([])
    expect(after).toEqual(before)
  })

  it('finds the track whichever Unicode form the file name comes in and keeps the form Serato stored', () => {
    const nfc = 'Música/Uno.mp3'
    const db = concat([VERSION, track({ ttyp: 'mp3', pfil: nfc })])
    const { bytes: after, moved } = repointSeratoDatabase(db, [
      { from: nfc.normalize('NFD'), to: 'Música/Dos.mp3'.normalize('NFD') },
    ])

    expect(moved).toEqual([nfc.normalize('NFD')])
    expect(parseSeratoDatabase(after)[0].path).toBe('Música/Dos.mp3'.normalize('NFC'))
  })
})

describe('repointSeratoCrate', () => {
  it('moves the renamed track inside the crate and nothing else', () => {
    const before = bytes(PRUEBAS_CRATE)
    const after = repointSeratoCrate(before, [move('Pray.aiff', 'Pray (renamed).aiff')])

    expect(parseSeratoCrate(after)).toEqual(
      parseSeratoCrate(before).map((p) =>
        p === `${PRUEBAS}/Pray.aiff` ? `${PRUEBAS}/Pray (renamed).aiff` : p,
      ),
    )
    expect(repointSeratoCrate(after, [move('Pray (renamed).aiff', 'Pray.aiff')])).toEqual(before)
  })
})
