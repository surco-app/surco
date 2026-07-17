import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { buildRekordboxXml } from './rekordbox'

const track = (
  over: Omit<Partial<TrackItem>, 'meta'> & { meta?: Partial<TrackMetadata> },
): TrackItem =>
  ({
    id: over.id ?? 'x',
    inputPath: over.inputPath ?? '/music/x.wav',
    fileName: over.fileName ?? 'x.wav',
    duration: over.duration,
    outputPath: over.outputPath,
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

describe('buildRekordboxXml', () => {
  const xml = buildRekordboxXml([
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
        year: '1999',
      },
    }),
    track({ id: 'b', inputPath: '/music/b.aiff', meta: { title: 'B Side', artist: 'Nobody' } }),
  ])

  it('wraps the tracks in a rekordbox DJ_PLAYLISTS document', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<DJ_PLAYLISTS Version="1.0.0">')
    expect(xml).toContain('<COLLECTION Entries="2">')
  })

  it('maps a track’s metadata onto TRACK attributes', () => {
    expect(xml).toContain('Name="Run To Me"')
    expect(xml).toContain('Artist="Ruffcut"')
    expect(xml).toContain('Album="21st Century"')
    expect(xml).toContain('Genre="Hardcore"')
    expect(xml).toContain('TotalTime="313"')
    expect(xml).toContain('AverageBpm="160"')
    expect(xml).toContain('Tonality="8A"')
  })

  it('encodes the file path as a file://localhost URL', () => {
    // rekordbox imports by Location; spaces must be percent-encoded or the import breaks.
    expect(xml).toContain('Location="file://localhost/music/Run%20To%20Me.wav"')
  })

  // encodeURI leaves the URL separators # and ? alone; either one truncates the
  // Location at import time (fragment/query boundary) and rekordbox silently drops the
  // track. Question-titled filenames are legal and common on macOS.
  it('percent-encodes # and ? in the file path', () => {
    const withPunct = buildRekordboxXml([
      track({ id: 'q', inputPath: '/music/What Is Love? #1.wav' }),
    ])
    expect(withPunct).toContain(
      'Location="file://localhost/music/What%20Is%20Love%3F%20%231.wav"',
    )
  })

  it('labels the kind from the file extension', () => {
    expect(xml).toContain('Kind="WAV File"')
    expect(xml).toContain('Kind="AIFF File"')
  })

  it('points the Location at the converted output when present', () => {
    const out = buildRekordboxXml([
      track({ id: 'a', inputPath: '/in/a.wav', outputPath: '/out/a.aiff', meta: { title: 'A' } }),
    ])
    expect(out).toContain('Location="file://localhost/out/a.aiff"')
  })

  it('escapes XML metacharacters in attribute values', () => {
    const out = buildRekordboxXml([track({ id: 'a', meta: { title: 'Tom & "Jerry" <mix>' } })])
    expect(out).toContain('Name="Tom &amp; &quot;Jerry&quot; &lt;mix&gt;"')
  })

  it('adds a Surco playlist node referencing every track by id', () => {
    expect(xml).toContain('<NODE Name="Surco" Type="1" Entries="2">')
    expect(xml).toContain('<TRACK Key="1">')
    expect(xml).toContain('<TRACK Key="2">')
  })
})
