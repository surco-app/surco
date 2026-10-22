import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hotCueArgb } from '../shared/rekordboxCueColors'
import { nmlCuesAt, rekordboxColorOf } from './traktorNmlCues'

const TRAKTOR_4 = readFileSync(
  join(import.meta.dirname, 'fixtures', 'traktor-pro-4-collection.nml'),
  'utf8',
)

const OK = {
  volume: 'X:',
  dir: '/:Music Library/:Beatport/:2017/:Top 100 Dance (June 2017)/:',
  file: '020. James Blunt, Robin Schulz - OK (feat. James Blunt) (Extended Version).mp3',
}

const collection = (entries: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="19"><COLLECTION ENTRIES="1">${entries}</COLLECTION></NML>`

const entry = (location: { volume: string; dir: string; file: string }, cues: string) =>
  `<ENTRY TITLE="t"><LOCATION DIR="${location.dir}" FILE="${location.file}" VOLUME="${location.volume}" VOLUMEID="v"></LOCATION>${cues}</ENTRY>`

describe('nmlCuesAt', () => {
  it('reads every cue a Traktor Pro 4 collection keeps for a track, with its slot, position and colour', () => {
    expect(nmlCuesAt(TRAKTOR_4, OK)).toEqual([
      { name: 'AutoGrid', type: 0, startMs: 240.127817, lengthMs: 0, hotcue: 0, color: '#FFFFFF' },
      { name: 'n.n.', type: 0, startMs: 8088.7, lengthMs: 0, hotcue: 1, color: null },
      { name: 'n.n.', type: 0, startMs: 28272.914885, lengthMs: 0, hotcue: 5, color: null },
      { name: 'n.n.', type: 0, startMs: 62239.3, lengthMs: 0, hotcue: 2, color: null },
      { name: 'n.n.', type: 0, startMs: 108959, lengthMs: 0, hotcue: 3, color: null },
    ])
  })

  it('leaves out the beat grid anchor, whose start is a phase rather than a place to jump to', () => {
    expect(nmlCuesAt(TRAKTOR_4, OK)?.some((c) => c.type === 4)).toBe(false)
  })

  it('reads a Traktor Pro 3 collection, which writes no colour, as cues without one', () => {
    const nml = collection(
      entry(
        OK,
        '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="52.315876" LEN="0.000000" REPEATS="-1" HOTCUE="7"/>',
      ),
    )
    expect(nmlCuesAt(nml, OK)).toEqual([
      { name: 'n.n.', type: 0, startMs: 52.315876, lengthMs: 0, hotcue: 7, color: null },
    ])
  })

  it('keeps the length of a loop and the cues that are not on a hot cue pad', () => {
    const nml = collection(
      entry(
        OK,
        '<CUE_V2 NAME="Loop" DISPL_ORDER="0" TYPE="5" START="1000.000000" LEN="1875.000000" REPEATS="-1" HOTCUE="2" COLOR="#00FF00"></CUE_V2>' +
          '<CUE_V2 NAME="Load" DISPL_ORDER="0" TYPE="3" START="500.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"/>',
      ),
    )
    expect(nmlCuesAt(nml, OK)).toEqual([
      { name: 'Loop', type: 5, startMs: 1000, lengthMs: 1875, hotcue: 2, color: '#00FF00' },
      { name: 'Load', type: 3, startMs: 500, lengthMs: 0, hotcue: -1, color: null },
    ])
  })

  it('reads a cue name Traktor escaped back as the DJ wrote it', () => {
    const nml = collection(
      entry(
        OK,
        '<CUE_V2 NAME="Drop &amp; break" DISPL_ORDER="0" TYPE="0" START="1.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0"/>',
      ),
    )
    expect(nmlCuesAt(nml, OK)?.[0].name).toBe('Drop & break')
  })

  it('finds a track whose accents Traktor and the disk spell in different Unicode forms', () => {
    const nfd = { volume: 'Música', dir: '/:Música/:', file: 'Canción.mp3'.normalize('NFD') }
    const nml = collection(
      entry(
        {
          volume: 'Música'.normalize('NFD'),
          dir: '/:Música/:'.normalize('NFD'),
          file: 'Canción.mp3',
        },
        '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="1.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0"/>',
      ),
    )
    expect(nmlCuesAt(nml, nfd)).toHaveLength(1)
  })

  it('tells a track the collection does not hold apart from one that has no cues', () => {
    expect(nmlCuesAt(TRAKTOR_4, { ...OK, file: 'not there.mp3' })).toBeNull()
    expect(nmlCuesAt(collection(entry(OK, '')), OK)).toEqual([])
  })
})

describe('rekordboxColorOf', () => {
  it('turns a Traktor colour into the rekordbox swatch closest to it', () => {
    expect(rekordboxColorOf('#FFFFFF')).not.toBeNull()
    expect(hotCueArgb(rekordboxColorOf('#305AFF'))).toBe(0xff305aff)
  })

  it('has no swatch for a cue Traktor gave no colour or an unreadable one', () => {
    expect(rekordboxColorOf(null)).toBeNull()
    expect(rekordboxColorOf('blue')).toBeNull()
  })
})
