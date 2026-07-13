import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { buildTraktorNml } from './traktor'

const track = (
  over: Omit<Partial<TrackItem>, 'meta'> & { meta?: Partial<TrackMetadata> },
): TrackItem =>
  ({
    id: over.id ?? 'x',
    inputPath: over.inputPath ?? '/music/x.wav',
    fileName: over.fileName ?? 'x.wav',
    duration: over.duration,
    outputPath: over.outputPath,
    beatgrid: over.beatgrid,
    trim: over.trim,
    meta: {
      title: '',
      artist: '',
      album: '',
      genre: '',
      bpm: '',
      key: '',
      trackNumber: '',
      year: '',
      ...over.meta,
    },
  }) as TrackItem

describe('buildTraktorNml', () => {
  const nml = buildTraktorNml([
    track({
      id: 'a',
      inputPath: '/music/Run To Me.wav',
      duration: 313,
      meta: {
        title: 'Run To Me',
        artist: 'Ruffcut',
        album: '21st Century',
        genre: 'Hardcore',
        bpm: '160',
        key: '8A',
        trackNumber: '1',
      },
    }),
    track({ id: 'b', inputPath: '/music/b.aiff', meta: { title: 'B Side', artist: 'Nobody' } }),
  ])

  it('wraps the tracks in a Traktor NML collection document', () => {
    expect(nml).toContain('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
    expect(nml).toContain('<NML VERSION="19">')
    expect(nml).toContain('PROGRAM="Traktor"')
    expect(nml).toContain('<COLLECTION ENTRIES="2">')
  })

  it('maps a track’s metadata onto the ENTRY', () => {
    expect(nml).toContain('TITLE="Run To Me"')
    expect(nml).toContain('ARTIST="Ruffcut"')
    expect(nml).toContain('<ALBUM TITLE="21st Century" TRACK="1">')
    expect(nml).toContain('GENRE="Hardcore"')
    expect(nml).toContain('PLAYTIME="313"')
    expect(nml).toContain('KEY="8A"')
  })

  it('formats the BPM as a Traktor TEMPO float', () => {
    expect(nml).toContain('<TEMPO BPM="160.000000"')
  })

  it('encodes the LOCATION with Traktor /: path separators and a literal filename', () => {
    // Traktor splits the dir on "/:" and keeps the filename literal (XML-escaped only),
    // unlike rekordbox which percent-encodes the whole URL.
    expect(nml).toContain('DIR="/:music/:"')
    expect(nml).toContain('FILE="Run To Me.wav"')
  })

  it('references each track in a Surco playlist by its Traktor key', () => {
    expect(nml).toContain('<NODE TYPE="PLAYLIST" NAME="Surco">')
    expect(nml).toContain('KEY="/:music/:Run To Me.wav"')
  })

  it('uses the Windows drive letter as the VOLUME', () => {
    const win = buildTraktorNml([
      track({ id: 'a', inputPath: 'C:\\Music\\track.wav', meta: { title: 'A' } }),
    ])
    expect(win).toContain('VOLUME="C:"')
    expect(win).toContain('DIR="/:Music/:"')
    expect(win).toContain('KEY="C:/:Music/:track.wav"')
  })

  it('points the LOCATION at the converted output when present', () => {
    const out = buildTraktorNml([
      track({ id: 'a', inputPath: '/in/a.wav', outputPath: '/out/a.aiff', meta: { title: 'A' } }),
    ])
    expect(out).toContain('DIR="/:out/:"')
    expect(out).toContain('FILE="a.aiff"')
  })

  it('escapes XML metacharacters in attribute values', () => {
    const out = buildTraktorNml([track({ id: 'a', meta: { title: 'Tom & "Jerry" <mix>' } })])
    expect(out).toContain('TITLE="Tom &amp; &quot;Jerry&quot; &lt;mix&gt;"')
  })
})

// The staged beatgrid travels as Traktor's grid marker: a CUE_V2 with TYPE="4"
// whose START (milliseconds) anchors the grid the sibling TEMPO's BPM spaces.
describe('buildTraktorNml beatgrid', () => {
  it('emits a TYPE 4 grid marker with a millisecond START', () => {
    const out = buildTraktorNml([
      track({ id: 'a', beatgrid: { bpm: 128, anchorSec: 0.052 }, meta: { title: 'A' } }),
    ])
    expect(out).toContain(
      '<CUE_V2 NAME="Beat Marker" DISPL_ORDER="0" TYPE="4" START="52.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>',
    )
    expect(out).toContain('<TEMPO BPM="128.000000"')
  })

  // The grid's tempo IS the track's tempo once the user confirmed it; a stale
  // free-text tag must not space the grid differently than the marker anchors it.
  it('prefers the grid bpm over the bpm tag in TEMPO', () => {
    const out = buildTraktorNml([
      track({ id: 'a', beatgrid: { bpm: 128, anchorSec: 0 }, meta: { bpm: '90' } }),
    ])
    expect(out).toContain('<TEMPO BPM="128.000000"')
    expect(out).not.toContain('BPM="90.000000"')
  })

  it('emits no grid marker without a grid', () => {
    const out = buildTraktorNml([track({ id: 'a', meta: { bpm: '90' } })])
    expect(out).not.toContain('CUE_V2')
  })

  // The grid is stored in original-file seconds; a converted output had the
  // trimmed head cut off, so the marker shifts back by it.
  it('offsets the marker by the trimmed head on a converted track', () => {
    const out = buildTraktorNml([
      track({
        id: 'a',
        beatgrid: { bpm: 120, anchorSec: 2 },
        trim: { startSec: 1.5 },
        outputPath: '/out/a.aiff',
      }),
    ])
    expect(out).toContain('TYPE="4" START="500.000000"')
  })
})
