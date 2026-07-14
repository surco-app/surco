import { gridSegments } from '../../../shared/beatgrid'
import type { TrackItem } from '../types'
import { exportedBeatgrid } from './beatgrid'
import { escapeXml } from './xml'

// Builds a rekordbox-importable collection XML (DJ_PLAYLISTS v1) from the loaded
// tracks, plus a single "Surco" playlist referencing them all. rekordbox imports each
// TRACK by its Location URL, so the path is the one part that must be exactly right;
// everything else is best-effort metadata. Pure so it can be unit-tested without the
// filesystem — the caller writes the returned string to disk.

// rekordbox wants a file://localhost/<absolute-path> URL with the path percent-encoded
// (spaces especially, or the import silently drops the track).
function trackLocation(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`
  // encodeURI leaves the URL separators # and ? alone; either one truncates the
  // Location at import (fragment/query boundary) and rekordbox silently drops the track.
  return `file://localhost${encodeURI(absolute).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

const KINDS: Record<string, string> = {
  wav: 'WAV File',
  aiff: 'AIFF File',
  aif: 'AIFF File',
  mp3: 'MP3 File',
  flac: 'FLAC File',
}

function kindFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return KINDS[ext] ?? `${ext.toUpperCase()} File`
}

export function buildRekordboxXml(tracks: TrackItem[]): string {
  const entries = tracks.map((t, i) => {
    // Point at the converted output when there is one; rekordbox should reference the
    // file the DJ will actually play, not the pre-conversion source.
    const path = t.outputPath ?? t.inputPath
    const m = t.meta
    const grid = t.beatgrid
    const attrs: [string, string][] = [
      ['TrackID', String(i + 1)],
      ['Name', m.title || t.fileName],
      ['Artist', m.artist],
      ['Album', m.album],
      ['Genre', m.genre],
      ['Kind', kindFromPath(path)],
      ['TotalTime', t.duration !== undefined ? String(Math.round(t.duration)) : ''],
      // The grid's tempo IS the track's tempo once the user confirmed it; a
      // stale free-text tag must not contradict the grid rekordbox will draw.
      ['AverageBpm', grid ? grid.bpm.toFixed(2) : m.bpm],
      ['Tonality', m.key],
      ['TrackNumber', m.trackNumber],
      ['Year', m.year],
      ['Location', trackLocation(path)],
    ]
    const rendered = attrs
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}="${escapeXml(value)}"`)
      .join(' ')
    const outGrid = exportedBeatgrid(t)
    if (!grid || !outGrid) return `    <TRACK ${rendered}/>`
    // The staged beatgrid, as rekordbox's grid structure: one TEMPO node per
    // segment, Inizio = seconds to that segment's first beat. Battito pins
    // each anchor to beat 1 of a 4/4 bar — Surco detects no downbeats, so this
    // is the same assumption the section's visual downbeat count makes.
    const tempoNodes = gridSegments(outGrid).map(
      (s) =>
        `      <TEMPO Inizio="${s.anchorSec.toFixed(3)}" Bpm="${s.bpm.toFixed(2)}" Metro="4/4" Battito="1"/>`,
    )
    return [`    <TRACK ${rendered}>`, ...tempoNodes, '    </TRACK>'].join('\n')
  })
  const playlistTracks = tracks.map((_t, i) => `      <TRACK Key="${i + 1}"></TRACK>`).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="Surco" Version="1.0" Company="Surco"/>',
    `  <COLLECTION Entries="${tracks.length}">`,
    ...entries,
    '  </COLLECTION>',
    '  <PLAYLISTS>',
    '    <NODE Type="0" Name="ROOT" Count="1">',
    `      <NODE Name="Surco" Type="1" Entries="${tracks.length}">`,
    playlistTracks,
    '      </NODE>',
    '    </NODE>',
    '  </PLAYLISTS>',
    '</DJ_PLAYLISTS>',
    '',
  ].join('\n')
}
