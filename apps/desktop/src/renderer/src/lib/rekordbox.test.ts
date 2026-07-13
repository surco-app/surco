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

// The staged beatgrid travels as rekordbox's TEMPO node: Inizio (seconds to the
// first beat), Bpm, Metro and Battito — one node = a constant grid. Battito is
// pinned to 1 (the anchor is assumed a bar start; Surco detects no downbeats).
describe('buildRekordboxXml beatgrid', () => {
  it('emits a TEMPO child inside the TRACK for a gridded track', () => {
    const out = buildRekordboxXml([
      track({ id: 'a', beatgrid: { bpm: 128, anchorSec: 0.052 }, meta: { title: 'A' } }),
    ])
    expect(out).toContain('<TEMPO Inizio="0.052" Bpm="128.00" Metro="4/4" Battito="1"/>')
    expect(out).toContain('</TRACK>')
  })

  // The grid's tempo IS the track's tempo once the user confirmed it; a stale
  // free-text tag must not contradict the grid rekordbox will draw.
  it('prefers the grid bpm over the bpm tag in AverageBpm', () => {
    const out = buildRekordboxXml([
      track({ id: 'a', beatgrid: { bpm: 128, anchorSec: 0 }, meta: { bpm: '90' } }),
    ])
    expect(out).toContain('AverageBpm="128.00"')
    expect(out).not.toContain('AverageBpm="90"')
  })

  it('keeps gridless tracks self-closing with no TEMPO node', () => {
    const out = buildRekordboxXml([track({ id: 'a', meta: { title: 'A', bpm: '90' } })])
    expect(out).not.toContain('<TEMPO')
    // The collection TRACK stays the one-line self-closing form (the playlist's
    // <TRACK Key> entries always close explicitly, so match the entry itself).
    expect(out).toMatch(/<TRACK TrackID="1"[^>]*\/>/)
  })

  // A multi-segment grid is exactly what rekordbox's TEMPO list expresses: one
  // node per segment, each anchoring its own bpm from its own beat 1.
  it('emits one TEMPO node per segment for a multi-segment grid', () => {
    const out = buildRekordboxXml([
      track({
        id: 'a',
        beatgrid: { bpm: 120, anchorSec: 0.25, changes: [{ anchorSec: 60.5, bpm: 130 }] },
        meta: { title: 'A' },
      }),
    ])
    expect(out).toContain('<TEMPO Inizio="0.250" Bpm="120.00" Metro="4/4" Battito="1"/>')
    expect(out).toContain('<TEMPO Inizio="60.500" Bpm="130.00" Metro="4/4" Battito="1"/>')
  })

  // The grid is stored in original-file seconds; a converted output had the
  // trimmed head cut off, so the marker shifts back by it.
  it('offsets Inizio by the trimmed head on a converted track', () => {
    const out = buildRekordboxXml([
      track({
        id: 'a',
        beatgrid: { bpm: 120, anchorSec: 2 },
        trim: { startSec: 1.5 },
        outputPath: '/out/a.aiff',
      }),
    ])
    expect(out).toContain('Inizio="0.500"')
  })

  it('folds Inizio forward by whole beats when the trim passes the anchor', () => {
    const out = buildRekordboxXml([
      track({
        id: 'a',
        beatgrid: { bpm: 120, anchorSec: 0.3 },
        trim: { startSec: 1.5 },
        outputPath: '/out/a.aiff',
      }),
    ])
    expect(out).toContain('Inizio="0.300"')
  })

  // An unconverted track exports its ORIGINAL file, head intact: a merely staged
  // trim must not move the marker.
  it('keeps the original-time anchor for an unconverted track', () => {
    const out = buildRekordboxXml([
      track({ id: 'a', beatgrid: { bpm: 120, anchorSec: 2 }, trim: { startSec: 1.5 } }),
    ])
    expect(out).toContain('Inizio="2.000"')
  })
})
