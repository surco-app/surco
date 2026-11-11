import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import {
  withVirtualdjCues,
  withVirtualdjSongAdded,
  withVirtualdjSongMoved,
  withVirtualdjTags,
} from './virtualdjDatabaseWrite'

const fixture = readFileSync(join(__dirname, 'virtualdjFixtures', 'database.xml'), 'utf8')
const FLAC = '/Music/Serato Pruebas/Pray.flac'
const SERATO_MP3 = '/Music/Serato Pruebas/Pray.mp3'
const M4A = '/Music/VirtualDJ Pruebas/Pray.m4a'

const lines = (xml: string) => xml.split('\r\n')
const changedLines = (before: string, after: string) => {
  const a = lines(before)
  const b = lines(after)
  return b.filter((line, i) => line !== a[i])
}
const songOf = (xml: string, path: string) => {
  const song = parseVirtualdjDatabase(xml).find((s) => s.path === path)
  if (!song) throw new Error(`missing ${path}`)
  return song
}
const noBareLf = (xml: string) => expect(xml.replace(/\r\n/g, '')).not.toContain('\n')

const flacCues = [
  { num: 1, seconds: 30, name: 'Surco', color: 4278190335 },
  { num: 2, seconds: 71.773787 },
  { num: 3, seconds: 142.561156 },
  { num: 4, seconds: 206.875442 },
  { num: 5, seconds: 247.963333 },
  { num: 6, seconds: 287.260113 },
  { num: 7, seconds: 330.023016 },
  { num: 8, seconds: 376.42619 },
]

describe('withVirtualdjCues', () => {
  it('gives back the same bytes when the cues are the ones already stored, so VirtualDJ never sees a rewritten database', () => {
    expect(withVirtualdjCues(fixture, FLAC, flacCues)).toBe(fixture)
  })

  it('changes only the line of the moved cue and keeps CRLF, because a database with LF is taken as corrupted and loses cues', () => {
    const cues = flacCues.map((c) => (c.num === 2 ? { ...c, seconds: 72.5 } : c))
    const out = withVirtualdjCues(fixture, FLAC, cues)
    if (out === null) throw new Error('song not found')
    expect(changedLines(fixture, out)).toEqual(['  <Poi Pos="72.5" Num="2" Type="cue" />'])
    expect(out.length).toBe(fixture.length - '71.773787'.length + '72.5'.length)
    noBareLf(out)
  })

  it('keeps the hot cues above 8, which the editor never shows and must not delete', () => {
    const out = withVirtualdjCues(fixture, FLAC, [{ num: 1, seconds: 10 }]) ?? ''
    const pois = songOf(out, FLAC).pois
    expect(pois.filter((p) => p.kind === 'cue')).toEqual([
      { kind: 'cue', num: 1, seconds: 10 },
      { kind: 'cue', num: 9, seconds: 60, name: 'Surco medida' },
    ])
    expect(pois.filter((p) => p.kind === 'other')).toHaveLength(9)
    noBareLf(out)
  })

  it('writes a new cue in VirtualDJ attribute order with its seconds style and ARGB color', () => {
    const out =
      withVirtualdjCues(fixture, M4A, [{ num: 4, seconds: 60, name: 'Drop', color: 0xff00ff00 }]) ??
      ''
    expect(out).toContain(
      '\r\n  <Poi Name="Drop" Pos="60.0" Num="4" Color="4278255360" Type="cue" />\r\n',
    )
    expect(
      songOf(out, M4A)
        .pois.filter((p) => p.kind === 'cue')
        .map((p) => p.num),
    ).toEqual([4])
  })

  it('escapes the five XML entities in a cue name, or VirtualDJ cannot read the database back', () => {
    const out =
      withVirtualdjCues(fixture, M4A, [{ num: 1, seconds: 1.5, name: `R&B "It's" <in>` }]) ?? ''
    expect(out).toContain('Name="R&amp;B &quot;It&apos;s&quot; &lt;in&gt;"')
    expect(songOf(out, M4A).pois.find((p) => p.kind === 'cue')?.name).toBe(`R&B "It's" <in>`)
  })

  it('leaves the stored loops alone when no loops are given, and replaces them when they are', () => {
    const cuesOf = songOf(fixture, SERATO_MP3)
      .pois.filter((p) => p.kind === 'cue')
      .map((p) => ({ num: p.num ?? 0, seconds: p.seconds, name: p.name, color: p.color }))
    expect(withVirtualdjCues(fixture, SERATO_MP3, cuesOf)).toBe(fixture)
    const out =
      withVirtualdjCues(fixture, SERATO_MP3, cuesOf, [
        { slot: 2, seconds: 100.25, sizeBeats: 8 },
      ]) ?? ''
    expect(out).not.toContain('Pos="278.306667"')
    expect(out).toContain('\r\n  <Poi Pos="100.25" Num="-1" Type="loop" Size="8.0" Slot="2" />\r\n')
    noBareLf(out)
  })

  it('answers null for a song VirtualDJ does not have, so the caller does not think it wrote', () => {
    expect(withVirtualdjCues(fixture, '/Music/nope.mp3', [])).toBeNull()
  })
})

describe('withVirtualdjSongMoved', () => {
  it('repoints the song to the converted file and shifts every point by the conversion offset', () => {
    const out =
      withVirtualdjSongMoved(
        fixture,
        FLAC,
        { path: '/Music/Serato Pruebas/Pray & Co.aiff', size: 123 },
        0.5,
        null,
      ) ?? ''
    expect(out).toContain(
      '<Song FilePath="/Music/Serato Pruebas/Pray &amp; Co.aiff" FileSize="123" Flag="268435456">',
    )
    const before = songOf(fixture, FLAC)
    const after = songOf(out, '/Music/Serato Pruebas/Pray & Co.aiff')
    expect(after.pois.map((p) => p.seconds)).toEqual(
      before.pois.map((p) => Number((p.seconds + 0.5).toFixed(6))),
    )
    expect(after.title).toBe(before.title)
    expect(out).toContain('<Comment>℗ 1998 Zomba Records Ltd.')
    noBareLf(out)
  })

  it('drops the points that fall outside the new file instead of leaving cues past its end', () => {
    const out =
      withVirtualdjSongMoved(fixture, SERATO_MP3, { path: '/x.flac', size: 1 }, -30, 250) ?? ''
    const pois = songOf(out, '/x.flac').pois
    expect(pois.every((p) => p.seconds >= 0 && p.seconds < 250)).toBe(true)
    expect(pois.some((p) => p.name === 'Surco')).toBe(false)
    expect(pois.find((p) => p.kind === 'loop')).toBeUndefined()
    expect(pois.find((p) => p.num === 8)?.seconds).toBe(208.299478)
    noBareLf(out)
  })

  it('drops a loop whose end passes the limit even when its start is inside', () => {
    const out =
      withVirtualdjSongMoved(fixture, SERATO_MP3, { path: '/x.flac', size: 1 }, 0, 279) ?? ''
    expect(songOf(out, '/x.flac').pois.find((p) => p.kind === 'loop')).toBeUndefined()
    const kept =
      withVirtualdjSongMoved(fixture, SERATO_MP3, { path: '/x.flac', size: 1 }, 0, 281) ?? ''
    expect(songOf(kept, '/x.flac').pois.find((p) => p.kind === 'loop')?.seconds).toBe(278.306667)
  })

  it('changes only the song line when there is no offset', () => {
    const out = withVirtualdjSongMoved(fixture, FLAC, { path: '/x.flac', size: 1 }, 0, null) ?? ''
    expect(changedLines(fixture, out)).toEqual([
      ' <Song FilePath="/x.flac" FileSize="1" Flag="268435456">',
    ])
  })

  it('answers null for a song VirtualDJ does not have', () => {
    expect(withVirtualdjSongMoved(fixture, '/nope', { path: '/x', size: 1 }, 0, null)).toBeNull()
  })
})

describe('withVirtualdjSongMoved grid and collisions', () => {
  const phaseOf = (xml: string, path: string) => songOf(xml, path).phaseSeconds

  it('shifts the grid with the cues, because Phase is a beat position on the same clock', () => {
    const out =
      withVirtualdjSongMoved(fixture, FLAC, { path: '/x.flac', size: 1 }, 0.25, null) ?? ''
    expect(phaseOf(out, '/x.flac')).toBe(57.809502)
    expect(out).toContain(' Phase="57.809502" ')
  })

  it('wraps a grid that would start before the file onto the next whole beat so it stays a valid anchor', () => {
    const out = withVirtualdjSongMoved(fixture, FLAC, { path: '/x.flac', size: 1 }, -58, null) ?? ''
    expect(phaseOf(out, '/x.flac')).toBe(Number((57.559502 - 58 + 0.447778).toFixed(6)))
    const far = withVirtualdjSongMoved(fixture, FLAC, { path: '/x.flac', size: 1 }, -59, null) ?? ''
    expect(phaseOf(far, '/x.flac')).toBe(Number((57.559502 - 59 + 4 * 0.447778).toFixed(6)))
  })

  it('refuses to move onto a path that is already another song, or VirtualDJ would hold it twice', () => {
    expect(withVirtualdjSongMoved(fixture, FLAC, { path: SERATO_MP3, size: 1 }, 0, null)).toBeNull()
  })
})

describe('withVirtualdjTags', () => {
  it('changes only the given attributes, escaped, and keeps the order of the others', () => {
    const out = withVirtualdjTags(fixture, M4A, { Title: 'Pray & "Remix"', Genre: 'Trance' }) ?? ''
    expect(changedLines(fixture, out)).toEqual([
      '  <Tags Author="Tina Cousins" Title="Pray &amp; &quot;Remix&quot;" Genre="Trance" Album="Pray" TrackNumber="1" Year="1998" Bpm="0.447761" Key="Ebm" Flag="1" />',
    ])
    noBareLf(out)
  })

  it('adds an attribute the song did not have yet', () => {
    const wav = '/Music/VirtualDJ Pruebas/Pray.wav'
    const out = withVirtualdjTags(fixture, wav, { Album: 'Pray', Author: 'Tina' }) ?? ''
    expect(songOf(out, wav)).toMatchObject({ artist: 'Tina', album: 'Pray' })
    const noAlbum =
      withVirtualdjTags(fixture.replace(' Album="Pray" Bpm', ' Bpm'), wav, { Album: 'New' }) ?? ''
    expect(songOf(noAlbum, wav).album).toBe('New')
  })

  it('creates the Tags element as the first child when the song has none, so the edit is not lost', () => {
    const bare = fixture.replace(
      /(<Song FilePath="\/Music\/VirtualDJ Pruebas\/Pray\.wav"[^>]*>\r\n) {2}<Tags [^\r]*\r\n/,
      '$1',
    )
    const wav = '/Music/VirtualDJ Pruebas/Pray.wav'
    const out = withVirtualdjTags(bare, wav, { Title: 'A & B' }) ?? ''
    expect(out).toContain(
      '<Song FilePath="/Music/VirtualDJ Pruebas/Pray.wav" FileSize="75550522">\r\n  <Tags Title="A &amp; B" />\r\n  <Infos ',
    )
    expect(songOf(out, wav).title).toBe('A & B')
    noBareLf(out)
  })

  it('keeps the bytes when the values are already the stored ones', () => {
    expect(withVirtualdjTags(fixture, M4A, { Title: 'Pray (W.I.P. In The Church Mix)' })).toBe(
      fixture,
    )
  })

  it('answers null for a song VirtualDJ does not have', () => {
    expect(withVirtualdjTags(fixture, '/nope', { Title: 'x' })).toBeNull()
  })
})

describe('withVirtualdjSongAdded', () => {
  const song = {
    path: '/Music/New & Old.mp3',
    size: 42,
    title: 'Title',
    artist: "O'Neil",
    album: '',
    genre: 'House',
  }

  it('appends a CRLF song with its tags before the end of the database, in VirtualDJ indentation', () => {
    const out = withVirtualdjSongAdded(fixture, song) ?? ''
    expect(out.slice(0, fixture.length - '</VirtualDJ_Database>\r\n'.length)).toBe(
      fixture.slice(0, fixture.length - '</VirtualDJ_Database>\r\n'.length),
    )
    expect(
      out.endsWith(
        ' <Song FilePath="/Music/New &amp; Old.mp3" FileSize="42" Flag="268435456">\r\n' +
          '  <Tags Author="O&apos;Neil" Title="Title" Genre="House" />\r\n' +
          ' </Song>\r\n' +
          '</VirtualDJ_Database>\r\n',
      ),
    ).toBe(true)
    expect(songOf(out, song.path)).toMatchObject({
      size: 42,
      artist: "O'Neil",
      title: 'Title',
      genre: 'House',
    })
  })

  it('answers null when the song is already there, so it is never listed twice', () => {
    expect(withVirtualdjSongAdded(fixture, { ...song, path: FLAC })).toBeNull()
  })
})
