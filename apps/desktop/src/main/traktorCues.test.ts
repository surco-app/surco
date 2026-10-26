import { describe, expect, it } from 'vitest'
import { HOT_KINDS } from '../shared/cueRules'
import { traktorContentId } from '../shared/traktorContent'
import { readTraktorTrackCues, traktorEntryBlock } from './traktorCues'
import { rekordboxColorOf } from './traktorNmlCues'
import { TRAKTOR_TYPE_COLOR } from './traktorPlaylists'

const KEY = 'Macintosh HD/:Users/:dj/:Music/:power.flac'
const ID = traktorContentId(KEY)

const GRID =
  '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="11.333358" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="128.000000"></GRID>\n</CUE_V2>'
const DJOTAS = [
  GRID,
  '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="0" START="11.333358" LEN="0.000000" REPEATS="-1" HOTCUE="0" COLOR="#FFFFFF"></CUE_V2>',
  '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="3" START="13739.225711" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>',
  '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="92674.606740" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>',
  '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="1" START="133858.283798" LEN="0.000000" REPEATS="-1" HOTCUE="3"></CUE_V2>',
  '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="5" START="187053.866666" LEN="1715.986544" REPEATS="-1" HOTCUE="4"></CUE_V2>',
]

const entry = (cues: string[], key = KEY) => {
  const file = key.slice(key.lastIndexOf('/:') + 2)
  const dir = key.slice('Macintosh HD'.length, key.lastIndexOf('/:') + 2)
  return `<ENTRY TITLE="The Power"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="Macintosh HD" VOLUMEID="v"></LOCATION>\n<INFO PLAYTIME="240" PLAYTIME_FLOAT="240.000000" IMPORT_DATE="2026/10/1"></INFO>\n${cues.join('\n')}\n</ENTRY>`
}

const nml = (...entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><COLLECTION ENTRIES="${entries.length}">\n${entries.join('\n')}\n</COLLECTION></NML>`

const colorOf = (type: number) => rekordboxColorOf(TRAKTOR_TYPE_COLOR[type])

describe('readTraktorTrackCues', () => {
  it('reads the hot cues on buttons 2 to 8 under letters A to G, keeping the DJ load, fade and loop cues locked', () => {
    const read = readTraktorTrackCues(nml(entry(DJOTAS)), ID)
    expect(read?.cues).toEqual([
      { id: '2', ms: 13739.225711, kind: HOT_KINDS[0], color: colorOf(3), loop: true },
      { id: '3', ms: 92674.60674, kind: HOT_KINDS[1], color: colorOf(0) },
      { id: '4', ms: 133858.283798, kind: HOT_KINDS[2], color: colorOf(1), loop: true },
      { id: '5', ms: 187053.866666, kind: HOT_KINDS[3], color: colorOf(5), loop: true },
    ])
  })

  // Traktor has no CALL: a cue without a button is the DJ's own marker there, so Surco
  // leaves it out of the editor and never moves or deletes it.
  it('leaves cues without a button out of the editor', () => {
    const memory = (ms: number) =>
      `<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="${ms}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>`
    const read = readTraktorTrackCues(nml(entry([GRID, memory(1000), memory(2000)])), ID)
    expect(read?.cues).toEqual([])
  })

  it('keeps whatever holds button 1 out of the editor even when it is not AutoGrid', () => {
    const intro =
      '<CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="500.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>'
    expect(readTraktorTrackCues(nml(entry([GRID, intro])), ID)?.cues).toEqual([])
  })

  it('lays the beat grid from the grid marker as the first beat of a bar, across the whole track', () => {
    const read = readTraktorTrackCues(nml(entry(DJOTAS)), ID)
    expect(read?.analysed).toBe(true)
    expect(read?.durationMs).toBe(240000)
    expect(read?.grid[0]).toEqual({ ms: 11.333358, beat: 1 })
    const grid = read?.grid ?? []
    expect(grid[1].ms - grid[0].ms).toBeCloseTo(468.75, 6)
    expect(read?.grid.slice(0, 6).map((b) => b.beat)).toEqual([1, 2, 3, 4, 1, 2])
    expect(read?.grid.at(-1)?.ms).toBeLessThanOrEqual(240000)
  })

  it('extends the grid back before a marker that sits late in the track', () => {
    const late = GRID.replace('START="11.333358"', 'START="1000.000000"')
    const read = readTraktorTrackCues(nml(entry([late])), ID)
    expect(read?.grid[0].ms).toBeCloseTo(62.5, 6)
    expect(read?.grid.find((b) => Math.abs(b.ms - 1000) < 0.001)?.beat).toBe(1)
  })

  it('says a track Traktor never analysed has no grid, so Auto mark asks for the analysis', () => {
    const read = readTraktorTrackCues(nml(entry([])), ID)
    expect(read).toMatchObject({ analysed: false, grid: [], phrases: [], wave: null })
  })

  it('reads nothing for a key the collection does not hold', () => {
    expect(readTraktorTrackCues(nml(entry(DJOTAS)), traktorContentId('X/:nope.mp3'))).toBeNull()
    expect(traktorEntryBlock(nml(entry(DJOTAS)), 'X/:nope.mp3')).toBeNull()
  })

  it('shows an extra grid marker set on a button as a locked cue, so that button is never given away', () => {
    const marker =
      '<CUE_V2 NAME="Beat Marker" DISPL_ORDER="0" TYPE="4" START="50000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"><GRID BPM="128.000000"></GRID></CUE_V2>'
    expect(readTraktorTrackCues(nml(entry([GRID, marker])), ID)?.cues).toEqual([
      { id: '1', ms: 50000, kind: HOT_KINDS[1], color: expect.any(Number), loop: true },
    ])
  })

  it('leaves a cue on a button past 8 alone, since Surco has no letter for it', () => {
    const odd =
      '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="8"></CUE_V2>'
    expect(readTraktorTrackCues(nml(entry([GRID, odd])), ID)?.cues).toEqual([])
  })
})
