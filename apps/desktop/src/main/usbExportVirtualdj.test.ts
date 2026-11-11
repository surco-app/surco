import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBakenXml } from './bakenXml'
import { stageExport } from './usbExportStage'
import {
  readVirtualdjExportSelection,
  type VirtualdjClock,
  virtualdjExportClock,
} from './usbExportVirtualdj'
import { readVirtualdjLibrary, type VirtualdjLibrary } from './virtualdjLibrary'

const fixture = join(__dirname, 'virtualdjFixtures')
const MP3 = '/Music/Serato Pruebas/Pray.mp3'
const FLAC = '/Music/Serato Pruebas/Pray.flac'
const MP3_SHIFT = 26.12

function copied(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-vdj-usb-')), 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  return dir
}

const library = (dir = copied()): VirtualdjLibrary => readVirtualdjLibrary([{ dir, root: '/' }])

const clockOf = async (file: string): Promise<VirtualdjClock | null> =>
  file.endsWith('.mp3') ? { sampleRate: 44100, delta: MP3_SHIFT } : { sampleRate: 96000, delta: 0 }

function made(songs: string, list: string[]): VirtualdjLibrary {
  const dir = mkdtempSync(join(tmpdir(), 'surco-vdj-usb-made-'))
  writeFileSync(
    join(dir, 'database.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n${songs}</VirtualDJ_Database>\r\n`,
  )
  mkdirSync(join(dir, 'MyLists'))
  writeFileSync(
    join(dir, 'MyLists', 'Set.vdjfolder'),
    `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualFolder noDuplicates="no">\r\n${list
      .map((p, i) => `\t<song path="${p}" size="1" idx="${i}" />\r\n`)
      .join('')}</VirtualFolder>\r\n`,
  )
  return library(dir)
}

describe('readVirtualdjExportSelection', () => {
  it('exports a VirtualDJ list with its tracks in the order VirtualDJ shows them', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], { clockOf })
    expect(sel.playlists.map((p) => [p.name, p.folders, p.trackIds.length])).toEqual([
      ['Surco prueba', [], 5],
    ])
    expect(sel.tracks.map((t) => t.path)).toEqual([
      MP3,
      FLAC,
      '/Music/VirtualDJ Pruebas/Pray.aiff',
      '/Music/VirtualDJ Pruebas/Pray.m4a',
      '/Music/VirtualDJ Pruebas/Pray.wav',
    ])
  })

  it('puts a list inside its VirtualDJ folder', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Carpeta'], { clockOf })
    expect(sel.playlists.map((p) => [p.name, p.folders, p.folderIds])).toEqual([
      ['Dentro', ['Carpeta'], ['Carpeta']],
    ])
  })

  it('takes the facts VirtualDJ keeps of the song, its BPM from seconds per beat', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], { clockOf })
    expect(sel.tracks[0]).toMatchObject({
      title: 'Pray (W.I.P. In The Church Mix)',
      artist: 'Tina Cousins',
      album: 'Pray',
      genre: 'Electronic',
      key: 'Ebm',
      year: 1998,
      lengthSec: 428,
      sampleRate: 44100,
      fileType: 1,
      dateAdded: '2026-11-11',
    })
    expect(sel.tracks[0].bpm).toBeCloseTo(60 / 0.447778, 6)
  })

  it('moves the hot cues and the saved loop onto rekordbox clock, so each falls where VirtualDJ plays it on a CDJ', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], { clockOf })
    const cues = sel.tracks[0].cues
    expect(cues).toHaveLength(9)
    expect(cues[0]).toMatchObject({ kind: 1, comment: 'Surco', outMs: -1 })
    expect(cues[0].inMs).toBeCloseTo(29973.878 + MP3_SHIFT, 6)
    const loop = cues[8]
    expect(loop).toMatchObject({ kind: 0, comment: 'loop' })
    expect(loop.inMs).toBeCloseTo(278306.667 + MP3_SHIFT, 6)
    expect(loop.outMs).toBeCloseTo((278.306667 + 4 * 0.447778) * 1000 + MP3_SHIFT, 6)
  })

  it('lays the grid from Scan Phase in steps of Bpm seconds, on rekordbox clock', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], { clockOf })
    const grid = sel.tracks[0].grid ?? []
    const first = 57559.456 - 128 * 447.778
    expect(grid[0]).toMatchObject({ beat: 1 })
    expect(grid[0].ms).toBeCloseTo(first + MP3_SHIFT, 6)
    expect(grid[1].ms - grid[0].ms).toBeCloseTo(447.778, 6)
    expect(grid[0].bpm).toBeCloseTo(60 / 0.447778, 6)
    expect(grid.some((b) => Math.abs(b.ms - (57559.456 + MP3_SHIFT)) < 1e-6)).toBe(true)
  })

  it('leaves out hot cues past the eighth, which have no pad on a CDJ', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], { clockOf })
    const flac = sel.tracks[1]
    expect(flac.cues.map((c) => c.kind)).toEqual([1, 2, 3, 5, 6, 7, 8, 9])
    expect(flac.cues.some((c) => c.comment === 'Surco medida')).toBe(false)
  })

  it('exports a song VirtualDJ never scanned with its cues and no grid, as Serato does with a track without one', async () => {
    const lib = made(
      ` <Song FilePath="/m/a.wav" FileSize="1">\r\n  <Infos SongLength="10.0" />\r\n  <Poi Name="In" Pos="2.0" Num="1" Type="cue" />\r\n </Song>\r\n`,
      ['/m/a.wav'],
    )
    const sel = await readVirtualdjExportSelection(lib, ['Set'], { clockOf })
    expect(sel.tracks[0]).toMatchObject({
      cues: [{ inMs: 2000, outMs: -1, kind: 1, comment: 'In' }],
      grid: [],
      bpm: 0,
    })
    expect(sel.tracks[0].cuesLeftOut).toBeFalsy()
  })

  it('leaves out the cues and grid of a file whose rekordbox shift is unknown, and counts it, since a guessed shift puts cues off the beat on a CDJ', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], {
      clockOf: async () => ({ sampleRate: 22050, delta: null }),
    })
    expect(sel.tracks[0]).toMatchObject({ cues: [], grid: [], cuesLeftOut: true })
  })

  it('keeps a track that is not on disk, with no cues and not counted as going without them, so the plan lists it as missing', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], {
      clockOf: async () => null,
    })
    expect(sel.tracks[0]).toMatchObject({ path: MP3, cues: [], grid: [] })
    expect(sel.tracks[0].cuesLeftOut).toBeFalsy()
  })

  it('names a list row VirtualDJ has no song for after its file', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco escrita'], { clockOf })
    expect(sel.tracks[0]).toMatchObject({
      path: '/Music/VirtualDJ Pruebas/Pray.flac',
      title: 'Pray',
    })
  })

  it('writes a hot cue, the loop and the grid into baken XML', async () => {
    const sel = await readVirtualdjExportSelection(library(), ['Surco prueba'], { clockOf })
    const xml = buildBakenXml(
      sel,
      new Map(sel.tracks.map((t) => [t.id, { size: 1, grid: t.grid ?? [] }])),
      'darwin',
    )
    expect(xml).toContain('<POSITION_MARK Name="Surco" Type="0" Start="30.000" Num="0"/>')
    expect(xml).toContain(
      '<POSITION_MARK Name="loop" Type="4" Start="278.333" End="280.124" Num="-1"/>',
    )
    expect(xml).toContain('<TEMPO Inizio="0.270" Bpm="133.99" Metro="4/4" Battito="1"/>')
  })
})

describe('the VirtualDJ export staged to a folder', () => {
  it('reads back from the staged collection the list, the cues, the loop and the grid of Surco prueba', async () => {
    const dir = copied()
    const music = mkdtempSync(join(tmpdir(), 'surco-vdj-usb-music-'))
    for (const name of ['database.xml', 'MyLists/Surco prueba.vdjfolder']) {
      const file = join(dir, name)
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('/Music/', `${music}/`))
    }
    for (const file of [MP3, FLAC, '/Music/VirtualDJ Pruebas/Pray.wav']) {
      const at = join(music, file.slice('/Music/'.length))
      mkdirSync(dirname(at), { recursive: true })
      writeFileSync(at, 'x')
    }
    const sel = await readVirtualdjExportSelection(library(dir), ['Surco prueba'], { clockOf })
    const out = mkdtempSync(join(tmpdir(), 'surco-vdj-usb-stage-'))
    const stage = await stageExport({
      sel,
      shareDir: '',
      settingsSource: null,
      dir: out,
      identity: null,
      deviceIds: new Map(),
      stickHas: [],
    })
    expect(stage.included).toHaveLength(3)
    expect(stage.missing).toHaveLength(2)
    const xml = readFileSync(stage.xml, 'utf8')
    const mp3 = xml.slice(xml.indexOf('Pray.mp3'), xml.indexOf('</TRACK>', xml.indexOf('Pray.mp3')))
    expect(mp3).toContain('<TEMPO Inizio="0.270" Bpm="133.99" Metro="4/4" Battito="1"/>')
    expect(mp3).toContain('<POSITION_MARK Name="Surco" Type="0" Start="30.000" Num="0"/>')
    expect(mp3).toContain(
      '<POSITION_MARK Name="loop" Type="4" Start="278.333" End="280.124" Num="-1"/>',
    )
    expect(xml).toMatch(/<NODE Name="Surco prueba" Type="1" KeyType="0" Entries="3">/)
  })
})

describe('virtualdjExportClock', () => {
  it('has nothing to give for a file that is not on disk', async () => {
    expect(await virtualdjExportClock('/nowhere/gone.mp3')).toBeNull()
  })

  it('reads the sample rate of the file, with no shift for a WAV', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-vdj-usb-wav-')), 'a.wav')
    const rate = 48000
    const data = Buffer.alloc(rate * 4)
    const head = Buffer.alloc(44)
    head.write('RIFF', 0, 'latin1')
    head.writeUInt32LE(36 + data.length, 4)
    head.write('WAVEfmt ', 8, 'latin1')
    head.writeUInt32LE(16, 16)
    head.writeUInt16LE(1, 20)
    head.writeUInt16LE(2, 22)
    head.writeUInt32LE(rate, 24)
    head.writeUInt32LE(rate * 4, 28)
    head.writeUInt16LE(4, 32)
    head.writeUInt16LE(16, 34)
    head.write('data', 36, 'latin1')
    head.writeUInt32LE(data.length, 40)
    writeFileSync(file, Buffer.concat([head, data]))
    expect(await virtualdjExportClock(file)).toEqual({ sampleRate: 48000, delta: 0 })
  })
})
