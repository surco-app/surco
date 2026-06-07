import type { TrackItem } from '../types'

// Builds a rekordbox-importable collection XML (DJ_PLAYLISTS v1) from the loaded
// tracks, plus a single "Surco" playlist referencing them all. rekordbox imports each
// TRACK by its Location URL, so the path is the one part that must be exactly right;
// everything else is best-effort metadata. Pure so it can be unit-tested without the
// filesystem — the caller writes the returned string to disk.

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

// rekordbox wants a file://localhost/<absolute-path> URL with the path percent-encoded
// (spaces especially, or the import silently drops the track).
function trackLocation(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://localhost${encodeURI(absolute).replace(/#/g, '%23')}`
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
    const attrs: [string, string][] = [
      ['TrackID', String(i + 1)],
      ['Name', m.title || t.fileName],
      ['Artist', m.artist],
      ['Album', m.album],
      ['Genre', m.genre],
      ['Kind', kindFromPath(path)],
      ['TotalTime', t.duration !== undefined ? String(Math.round(t.duration)) : ''],
      ['AverageBpm', m.bpm],
      ['Tonality', m.key],
      ['TrackNumber', m.trackNumber],
      ['Year', m.year],
      ['Location', trackLocation(path)],
    ]
    const rendered = attrs
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}="${escapeXml(value)}"`)
      .join(' ')
    return `    <TRACK ${rendered}/>`
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
