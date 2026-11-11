import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVirtualdjDatabase } from './virtualdjDatabase'

const fixture = readFileSync(join(__dirname, 'virtualdjFixtures', 'database.xml'), 'utf8')
const songs = parseVirtualdjDatabase(fixture)
const byPath = (p: string) => {
  const song = songs.find((s) => s.path === p)
  if (!song) throw new Error(`missing ${p}`)
  return song
}

describe('parseVirtualdjDatabase', () => {
  it('reads every song of the measured library keyed by its exact path', () => {
    expect(songs.map((s) => s.path)).toEqual([
      '/Music/VirtualDJ Pruebas/Pray.mp3',
      '/Music/Serato Pruebas/Pray.flac',
      '/Music/Serato Pruebas/Pray.mp3',
      '/Music/VirtualDJ Pruebas/Pray.m4a',
      '/Music/VirtualDJ Pruebas/Pray.wav',
      '/Music/VirtualDJ Pruebas/Pray.aiff',
    ])
  })

  it('maps the tags VirtualDJ shows, with Author as the artist', () => {
    expect(byPath('/Music/VirtualDJ Pruebas/Pray.mp3')).toMatchObject({
      size: 17138984,
      title: 'Pray (W.I.P. In The Church Mix)',
      artist: 'Tina Cousins',
      album: 'Pray',
      genre: 'Electronic',
      year: '1998',
      key: 'Ebm',
      lengthSeconds: 428.253333,
    })
  })

  it('takes the grid from Scan as seconds per beat, never as beats per minute', () => {
    const song = byPath('/Music/VirtualDJ Pruebas/Pray.mp3')
    expect(song.secondsPerBeat).toBe(0.447778)
    expect(song.phaseSeconds).toBe(57.559456)
  })

  it('keeps cues with their Num, name and ARGB color', () => {
    const cues = byPath('/Music/VirtualDJ Pruebas/Pray.m4a').pois.filter((p) => p.kind === 'cue')
    expect(cues).toEqual([
      { kind: 'cue', num: 1, seconds: 7.444, color: 4291559424 },
      { kind: 'cue', num: 2, seconds: 12.756, color: 4291594240 },
      { kind: 'cue', num: 3, seconds: 19.019, color: 4278190284 },
    ])
    expect(byPath('/Music/VirtualDJ Pruebas/Pray.mp3').pois[0]).toEqual({
      kind: 'cue',
      num: 1,
      seconds: 29.973878,
      name: 'Surco',
      color: 4278190335,
    })
  })

  it('keeps a cue numbered 9 so cues past the first eight are not dropped', () => {
    const cue = byPath('/Music/Serato Pruebas/Pray.flac').pois.find((p) => p.num === 9)
    expect(cue).toMatchObject({ kind: 'cue', seconds: 60, name: 'Surco medida' })
  })

  it('exposes a loop with its slot and its size in beats, since the file gives no seconds', () => {
    const loop = byPath('/Music/Serato Pruebas/Pray.mp3').pois.find((p) => p.kind === 'loop')
    expect(loop).toEqual({
      kind: 'loop',
      num: null,
      slot: 1,
      seconds: 278.306667,
      name: 'loop',
      color: 4278190335,
      sizeBeats: 4,
    })
  })

  it('tells automix and remix points apart from cues so they are never written back as cues', () => {
    const song = byPath('/Music/VirtualDJ Pruebas/Pray.mp3')
    expect(song.pois.filter((p) => p.kind === 'cue')).toHaveLength(1)
    expect(song.pois.filter((p) => p.kind === 'other')).toHaveLength(9)
  })

  it('reads the same with LF and CRLF line endings', () => {
    const lf = fixture.replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(parseVirtualdjDatabase(crlf)).toEqual(parseVirtualdjDatabase(lf))
  })

  it('returns nothing for a document without songs', () => {
    expect(
      parseVirtualdjDatabase('<VirtualDJ_Database Version="2026"></VirtualDJ_Database>'),
    ).toEqual([])
  })

  it('accepts a song with neither Tags, Infos nor Scan and leaves the unknowns null', () => {
    const [song] = parseVirtualdjDatabase('<Song FilePath="/a.mp3"></Song>')
    expect(song).toEqual({
      path: '/a.mp3',
      size: null,
      title: '',
      artist: '',
      album: '',
      genre: '',
      year: '',
      key: '',
      lengthSeconds: null,
      secondsPerBeat: null,
      phaseSeconds: null,
      pois: [],
    })
  })

  it('accepts a self-closing song', () => {
    expect(parseVirtualdjDatabase('<Song FilePath="/a.mp3" FileSize="5" />')[0]).toMatchObject({
      path: '/a.mp3',
      size: 5,
    })
  })

  it('falls back to the Tags Bpm when the song was never scanned, with no phase', () => {
    const [song] = parseVirtualdjDatabase('<Song FilePath="/a.mp3"><Tags Bpm="0.5" /></Song>')
    expect(song.secondsPerBeat).toBe(0.5)
    expect(song.phaseSeconds).toBeNull()
  })

  it('skips a Poi without Pos instead of inventing a position of zero', () => {
    const [song] = parseVirtualdjDatabase(
      '<Song FilePath="/a.mp3"><Poi Num="1" Type="cue" /><Poi Pos="2" Num="2" Type="cue" /></Song>',
    )
    expect(song.pois).toEqual([{ kind: 'cue', num: 2, seconds: 2 }])
  })

  it('ignores attributes it does not know', () => {
    const [song] = parseVirtualdjDatabase(
      '<Song FilePath="/a.mp3" Mystery="1"><Poi Pos="2" Num="1" Type="cue" Future="x" /></Song>',
    )
    expect(song.pois).toEqual([{ kind: 'cue', num: 1, seconds: 2 }])
  })

  it('decodes entities in paths and names so they match the file on disk', () => {
    const [song] = parseVirtualdjDatabase(
      '<Song FilePath="/M/A &amp; B &quot;x&quot; &#233;.mp3"><Tags Title="a &lt; b" /><Poi Name="&apos;go&apos;" Pos="1" Num="1" Type="cue" /></Song>',
    )
    expect(song.path).toBe('/M/A & B "x" é.mp3')
    expect(song.title).toBe('a < b')
    expect(song.pois[0].name).toBe("'go'")
  })

  it('returns a non-ASCII path exactly as written, without normalizing it', () => {
    const decomposed = '/Música/Canción.mp3'.normalize('NFD')
    const [song] = parseVirtualdjDatabase(`<Song FilePath="${decomposed}"></Song>`)
    expect(song.path).toBe(decomposed)
  })

  it('does not end a Poi early on a greater-than sign inside a value', () => {
    const [song] = parseVirtualdjDatabase(
      '<Song FilePath="/a.mp3"><Poi Name="a>b" Pos="3" Num="4" Type="cue" /></Song>',
    )
    expect(song.pois).toEqual([{ kind: 'cue', num: 4, seconds: 3, name: 'a>b' }])
  })
})
