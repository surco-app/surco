import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { buildTraktorNml } from './traktor'

const track = (over: Omit<Partial<TrackItem>, 'meta'> & { meta?: Partial<TrackMetadata> }): TrackItem =>
  ({
    id: over.id ?? 'x',
    inputPath: over.inputPath ?? '/music/x.wav',
    fileName: over.fileName ?? 'x.wav',
    duration: over.duration,
    outputPath: over.outputPath,
    meta: { title: '', artist: '', album: '', genre: '', bpm: '', key: '', trackNumber: '', year: '', ...over.meta },
  }) as TrackItem

describe('buildTraktorNml', () => {
  const nml = buildTraktorNml([
    track({
      id: 'a',
      inputPath: '/music/Run To Me.wav',
      duration: 313,
      meta: { title: 'Run To Me', artist: 'Ruffcut', album: '21st Century', genre: 'Hardcore', bpm: '160', key: '8A', trackNumber: '1' },
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
    const win = buildTraktorNml([track({ id: 'a', inputPath: 'C:\\Music\\track.wav', meta: { title: 'A' } })])
    expect(win).toContain('VOLUME="C:"')
    expect(win).toContain('DIR="/:Music/:"')
    expect(win).toContain('KEY="C:/:Music/:track.wav"')
  })

  it('points the LOCATION at the converted output when present', () => {
    const out = buildTraktorNml([track({ id: 'a', inputPath: '/in/a.wav', outputPath: '/out/a.aiff', meta: { title: 'A' } })])
    expect(out).toContain('DIR="/:out/:"')
    expect(out).toContain('FILE="a.aiff"')
  })

  it('escapes XML metacharacters in attribute values', () => {
    const out = buildTraktorNml([track({ id: 'a', meta: { title: 'Tom & "Jerry" <mix>' } })])
    expect(out).toContain('TITLE="Tom &amp; &quot;Jerry&quot; &lt;mix&gt;"')
  })
})
