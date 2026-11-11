import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HOT_KINDS } from '../shared/cueRules'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { virtualdjCueSource } from './virtualdjCueSource'

const { lists } = vi.hoisted(() => ({ lists: { reads: 0 } }))
vi.mock('./virtualdjLists', async (actual) => {
  const real = await actual<typeof import('./virtualdjLists')>()
  return {
    ...real,
    readVirtualdjLists: (...args: Parameters<typeof real.readVirtualdjLists>) => {
      lists.reads++
      return real.readVirtualdjLists(...args)
    },
  }
})

const fixture = join(__dirname, 'virtualdjFixtures')
const VDJ_MP3 = 'virtualdj:/Music/VirtualDJ Pruebas/Pray.mp3'
const SERATO_MP3 = 'virtualdj:/Music/Serato Pruebas/Pray.mp3'
const SERATO_FLAC = 'virtualdj:/Music/Serato Pruebas/Pray.flac'

function source(
  dir = fixture,
  words: (file: string) => Promise<Uint16Array | null> = async () => null,
  fine?: (file: string) => Promise<Uint8Array | null>,
) {
  return virtualdjCueSource({ dir: () => dir, words, fine }, () => '')
}

function library(songs: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'surco-vdj-cues-'))
  writeFileSync(
    join(dir, 'database.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n${songs}</VirtualDJ_Database>\r\n`,
  )
  return dir
}

const song = (path: string, body: string) =>
  ` <Song FilePath="${path}" FileSize="1">\r\n  <Infos SongLength="10.0" />\r\n${body} </Song>\r\n`

describe('virtualdjCueSource', () => {
  it('reads a hot cue on a FLAC at its Pos in Surco ms, since VirtualDJ counts on Surco’s clock', async () => {
    const read = await source().trackCues(SERATO_FLAC)
    expect(read?.cues[0]).toEqual({
      id: '1',
      ms: 30000,
      kind: HOT_KINDS[0],
      color: nearestHotCueColor(4278190335),
      name: 'Surco',
    })
  })

  it('reads a hot cue on an MP3 at its Pos with no encoder correction, since VirtualDJ’s own analysis lines up with Surco’s on every format', async () => {
    const read = await source().trackCues(VDJ_MP3)
    expect(read?.cues[0]?.ms).toBeCloseTo(29973.878, 3)
  })

  it('puts the same Pos at the same ms on an MP3 and a FLAC, so no per-format shift sneaks in', async () => {
    const body = `  <Scan Bpm="0.5" Phase="1.25" />\r\n  <Poi Pos="3.5" Num="1" Type="cue" />\r\n  <Poi Pos="2.0" Num="-1" Type="loop" Size="4.0" Slot="1" />\r\n`
    const dir = library(song('/m/a.mp3', body) + song('/m/a.flac', body) + song('/m/a.m4a', body))
    const [mp3, flac, m4a] = await Promise.all(
      ['/m/a.mp3', '/m/a.flac', '/m/a.m4a'].map((p) => source(dir).trackCues(`virtualdj:${p}`)),
    )
    expect(mp3?.cues).toEqual(flac?.cues)
    expect(mp3?.grid).toEqual(flac?.grid)
    expect(mp3?.loops).toEqual(flac?.loops)
    expect(m4a?.cues).toEqual(flac?.cues)
    expect(m4a?.grid).toEqual(flac?.grid)
  })

  it('maps pads 1 to 8 to the eight hot cue letters in order, as Serato does', async () => {
    const read = await source().trackCues(SERATO_MP3)
    expect(read?.cues.map((c) => c.kind)).toEqual(HOT_KINDS)
    expect(read?.cues.map((c) => c.name)).toEqual(['Surco', '2', '3', '4', '5', '6', '7', '8'])
  })

  it('leaves pads above 8 out of the editor rows, which only has eight letters', async () => {
    const read = await source().trackCues(SERATO_FLAC)
    expect(read?.cues).toHaveLength(8)
    expect(read?.cues.some((c) => c.ms === 60000)).toBe(false)
  })

  it('gives a cue VirtualDJ keeps without a colour no colour, so the editor draws its default', async () => {
    const read = await source().trackCues(SERATO_FLAC)
    expect(read?.cues[1]).toEqual({ id: '2', ms: 71773.787, kind: HOT_KINDS[1], color: null })
  })

  it('turns VirtualDJ’s ARGB colour into the nearest hot cue colour, the way Serato’s RGB is mapped', async () => {
    const read = await source().trackCues('virtualdj:/Music/VirtualDJ Pruebas/Pray.m4a')
    expect(read?.cues.map((c) => c.color)).toEqual([
      nearestHotCueColor(4291559424),
      nearestHotCueColor(4291594240),
      nearestHotCueColor(4278190284),
    ])
  })

  it('lays the grid on Phase plus whole beats of Scan Bpm, since Phase is one beat of the grid', async () => {
    const dir = library(song('/m/a.wav', `  <Scan Bpm="0.5" Phase="1.25" />\r\n`))
    const read = await source(dir).trackCues('virtualdj:/m/a.wav')
    expect(read?.analysed).toBe(true)
    expect(read?.grid.map((b) => b.ms).slice(0, 4)).toEqual([250, 750, 1250, 1750])
    expect(read?.grid.at(-1)?.ms).toBe(9750)
    expect(read?.grid).toHaveLength(20)
  })

  it('lays Pray’s grid on its Scan Phase, 128 beats before landing next to the start of the music', async () => {
    const read = await source().trackCues(VDJ_MP3)
    const near = read?.grid.find((b) => Math.abs(b.ms - 57559.456) < 1)
    expect(near).toBeDefined()
    expect(read?.grid[0]?.ms).toBeCloseTo(57559.456 - 128 * 447.778, 3)
  })

  it('counts a track VirtualDJ has not scanned as unanalysed, with no grid', async () => {
    const dir = library(song('/m/a.wav', `  <Poi Pos="3.5" Num="1" Type="cue" />\r\n`))
    const read = await source(dir).trackCues('virtualdj:/m/a.wav')
    expect(read?.analysed).toBe(false)
    expect(read?.grid).toEqual([])
    expect(read?.cues).toHaveLength(1)
  })

  it('ends a saved loop Size beats after its start, since VirtualDJ keeps the length in beats', async () => {
    const read = await source().trackCues(SERATO_MP3)
    expect(read?.loops).toHaveLength(1)
    expect(read?.loops?.[0]?.id).toBe('slot-1')
    expect(read?.loops?.[0]?.name).toBe('loop')
    expect(read?.loops?.[0]?.startMs).toBeCloseTo(278306.667, 3)
    expect(read?.loops?.[0]?.endMs).toBeCloseTo(278306.667 + 4 * 447.778, 3)
  })

  it('takes the track length from Infos, so the grid stops at the end', async () => {
    const read = await source().trackCues(VDJ_MP3)
    expect(read?.durationMs).toBeCloseTo(428253.333, 3)
    expect(read?.grid.at(-1)?.ms).toBeLessThanOrEqual(428253.333)
  })

  it('finds the song when the row and the database spell the path in different Unicode forms', async () => {
    const dir = library(song('/m/Canción.wav', `  <Poi Pos="3.5" Num="1" Type="cue" />\r\n`))
    const read = await source(dir).trackCues('virtualdj:/m/Canción.wav')
    expect(read?.cues).toHaveLength(1)
  })

  it('reads only the songs of the database for cues, never the lists, which can be a large tree', async () => {
    lists.reads = 0
    const read = source()
    await read.trackCues(VDJ_MP3)
    await read.dropInput(VDJ_MP3)
    expect(lists.reads).toBe(0)
  })

  it('keys each loop by its slot apart from a loop without one, so two loops never share a key', async () => {
    const dir = library(
      song(
        '/m/a.wav',
        `  <Scan Bpm="0.5" Phase="0.0" />\r\n  <Poi Pos="1.0" Type="loop" Size="4.0" />\r\n  <Poi Pos="2.0" Type="loop" Size="4.0" Slot="0" />\r\n`,
      ),
    )
    const read = await source(dir).trackCues('virtualdj:/m/a.wav')
    const ids = read?.loops?.map((l) => l.id) ?? []
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('reads nothing for a track the database does not hold', async () => {
    expect(await source().trackCues('virtualdj:/m/missing.mp3')).toBeNull()
  })

  it('draws the zoomed wave from Surco’s own analysis of the file, on the same clock', async () => {
    const words = vi.fn(async (_file: string) => new Uint16Array([3, 9]))
    const fine = vi.fn(async (_file: string) => new Uint8Array([1, 2]))
    const read = source(fixture, words, fine)
    expect([...((await read.waveDetail(VDJ_MP3)) ?? [])]).toEqual([3, 9])
    expect(words).toHaveBeenCalledWith('/Music/VirtualDJ Pruebas/Pray.mp3')
    expect((await read.fineWave(VDJ_MP3))?.startMs).toBe(0)
    expect(await read.auditionLead(VDJ_MP3)).toBe(0)
  })

  it('gives Auto mark VirtualDJ’s grid over Surco’s words when rekordbox lacks the file', async () => {
    const words = new Uint16Array([3, 9])
    const read = source(fixture, async () => words)
    const input = await read.dropInput(VDJ_MP3)
    expect(input?.words).toBe(words)
    expect(input?.grid).toEqual((await read.trackCues(VDJ_MP3))?.grid)
  })

  it('never queues anything, since Surco only reads VirtualDJ’s cues', async () => {
    const read = source()
    read.queue.enqueue([])
    expect(read.queue.cuesOp(VDJ_MP3)).toBeUndefined()
    expect(await read.queuedWanted(VDJ_MP3, {} as never)).toEqual([])
  })
})
