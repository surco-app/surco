import type { TrackItem } from '../types'
import { gridSegments } from '../../../shared/beatgrid'
import { exportedBeatgrid } from './beatgrid'

// Builds a Traktor collection (.nml) from the loaded tracks, plus a single "Surco"
// playlist. Like the rekordbox export it's a bridge file the user imports — Traktor
// can't be written to live. Pure so it's unit-tested without the filesystem.
//
// Traktor's path format is the fiddly part: LOCATION splits the directory on "/:" and
// keeps the filename literal (XML-escaped, NOT percent-encoded), with the volume held
// separately — a Windows drive letter, or empty for a POSIX boot-volume path (Traktor
// then resolves the absolute DIR). The playlist references a track by VOLUME+DIR+FILE.

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

function traktorLocation(path: string): { volume: string; dir: string; file: string; key: string } {
  const norm = path.replace(/\\/g, '/')
  // A Windows path keeps its drive letter as the VOLUME; a POSIX path leaves it empty.
  const drive = /^([A-Za-z]:)\/(.*)$/.exec(norm)
  const volume = drive ? drive[1] : ''
  const rest = drive ? `/${drive[2]}` : norm
  const lastSlash = rest.lastIndexOf('/')
  const file = rest.slice(lastSlash + 1)
  const segments = rest.slice(0, lastSlash).split('/').filter(Boolean)
  const dir = `/:${segments.map((s) => `${s}/:`).join('')}`
  return { volume, dir, file, key: volume + dir + file }
}

const KINDS: Record<string, string> = {
  wav: 'wav',
  aiff: 'aiff',
  aif: 'aiff',
  mp3: 'mp3',
  flac: 'flac',
}

function attrs(pairs: [string, string][]): string {
  return pairs
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ')
}

export function buildTraktorNml(tracks: TrackItem[]): string {
  const entries: string[] = []
  const playlist: string[] = []
  for (const t of tracks) {
    const path = t.outputPath ?? t.inputPath
    const loc = traktorLocation(path)
    const m = t.meta
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    entries.push(
      `    <ENTRY ${attrs([
        ['TITLE', m.title || t.fileName],
        ['ARTIST', m.artist],
      ])}>`,
      `      <LOCATION DIR="${escapeXml(loc.dir)}" FILE="${escapeXml(loc.file)}" VOLUME="${escapeXml(loc.volume)}" VOLUMEID="${escapeXml(loc.volume)}"></LOCATION>`,
      `      <ALBUM ${attrs([
        ['TITLE', m.album],
        ['TRACK', m.trackNumber],
      ])}></ALBUM>`,
      `      <INFO ${attrs([
        ['GENRE', m.genre],
        ['PLAYTIME', t.duration !== undefined ? String(Math.round(t.duration)) : ''],
        ['KEY', m.key],
        ['IMPORT_DATE', ''],
        ['FILESIZE', ''],
        ['COVERARTID', ''],
        ['BITRATE', ''],
        ['COMMENT', m.comment ?? ''],
        ['FILETYPE', KINDS[ext] ?? ext],
      ])}></INFO>`,
    )
    // The grid's tempo outranks the free-text tag once a grid is staged: the
    // TEMPO spaces the very grid the CUE_V2 marker below anchors.
    const bpm = t.beatgrid ? t.beatgrid.bpm : Number(m.bpm)
    if (Number.isFinite(bpm) && bpm > 0) {
      entries.push(`      <TEMPO BPM="${bpm.toFixed(6)}" BPM_QUALITY="100.000000"></TEMPO>`)
    }
    const outGrid = t.beatgrid ? exportedBeatgrid(t) : undefined
    if (outGrid) {
      // TYPE="4" is Traktor's grid marker; START is in milliseconds — one per
      // segment: Traktor keeps a single BPM per track, but every marker
      // re-anchors the phase, so the drift points a multi-segment grid pins
      // stay pinned. Traktor may still show the grid unlocked — LOCK on the
      // ENTRY is unverified against a real Traktor and stays a follow-up.
      for (const s of gridSegments(outGrid)) {
        const startMs = s.anchorSec * 1000
        entries.push(
          `      <CUE_V2 NAME="Beat Marker" DISPL_ORDER="0" TYPE="4" START="${startMs.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>`,
        )
      }
    }
    entries.push('    </ENTRY>')
    playlist.push(
      `          <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${escapeXml(loc.key)}"></PRIMARYKEY></ENTRY>`,
    )
  }
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<NML VERSION="19">',
    '  <HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>',
    '  <MUSICFOLDERS></MUSICFOLDERS>',
    `  <COLLECTION ENTRIES="${tracks.length}">`,
    ...entries,
    '  </COLLECTION>',
    '  <PLAYLISTS>',
    '    <NODE TYPE="FOLDER" NAME="$ROOT">',
    '      <SUBNODES COUNT="1">',
    '        <NODE TYPE="PLAYLIST" NAME="Surco">',
    `          <PLAYLIST ENTRIES="${tracks.length}" TYPE="LIST" UUID="surco">`,
    ...playlist,
    '          </PLAYLIST>',
    '        </NODE>',
    '      </SUBNODES>',
    '    </NODE>',
    '  </PLAYLISTS>',
    '</NML>',
    '',
  ].join('\n')
}
