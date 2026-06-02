import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TrackMetadata } from '../shared/types'

const run = promisify(execFile)

// Adds a file to Apple Music and writes every field directly onto the resulting
// track via AppleScript. We don't rely on Apple Music reading the AIFF tags,
// because it ignores several of them (year, grouping) — setting the track
// properties explicitly guarantees the library shows exactly what was edited,
// which is the whole point of the app. If "Copy files to Music Media folder"
// is enabled, the file is copied into the library too.
//
// `add` returns the track reference before Apple Music finishes importing the
// file, so writing properties straight away fails with paramErr (-50) on real
// (large) files. We retry the whole property block until the track settles,
// re-raise any other error, and fail loud if it never becomes writable.
export function buildAddScript(filePath: string, meta: TrackMetadata): string {
  const sets: string[] = []

  const text: [string, string][] = [
    ['name', meta.title],
    ['artist', meta.artist],
    ['album artist', meta.albumArtist],
    ['album', meta.album],
    ['genre', meta.genre],
    ['grouping', meta.grouping],
    ['comment', meta.comment],
  ]
  for (const [prop, value] of text) {
    if (value.trim()) sets.push(`      set ${prop} of theTrack to ${JSON.stringify(value)}`)
  }

  const numeric: [string, string][] = [
    ['year', meta.year],
    ['track number', meta.trackNumber],
    // bpm and disc number are the only advanced tags Music exposes to scripting;
    // key/publisher/catalog/remixer live solely in the file tag.
    ['disc number', meta.discNumber],
    ['bpm', meta.bpm],
  ]
  for (const [prop, value] of numeric) {
    const n = parseInt(value, 10)
    if (Number.isFinite(n) && n > 0) sets.push(`      set ${prop} of theTrack to ${n}`)
  }

  return [
    'tell application "Music"',
    `  set theTrack to add POSIX file ${JSON.stringify(filePath)}`,
    '  set metaSet to false',
    '  repeat 100 times',
    '    try',
    ...sets,
    '      set metaSet to true',
    '      exit repeat',
    '    on error errMsg number errNum',
    '      if errNum is not -50 then error errMsg number errNum',
    '      delay 0.1',
    '    end try',
    '  end repeat',
    '  if not metaSet then error "Apple Music no terminó de importar la pista a tiempo."',
    'end tell',
  ].join('\n')
}

export async function addToAppleMusic(filePath: string, meta: TrackMetadata): Promise<void> {
  await run('osascript', ['-e', buildAddScript(filePath, meta)])
}
