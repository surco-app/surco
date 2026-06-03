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
export function buildAddScript(filePath: string, meta: TrackMetadata, coverPath?: string): string {
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

  // Write the cover explicitly rather than trusting embedded art. Music reads
  // embedded artwork from AIFF/MP3 but ignores it in WAV, so for a uniform
  // result across every output format the artwork is set on the track directly,
  // inside the retry loop so a -50 raised mid-import does not drop it.
  if (coverPath?.trim()) {
    sets.push(
      `      set data of artwork 1 of theTrack to (read (POSIX file ${JSON.stringify(coverPath)}) as picture)`,
    )
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

// osascript and the Music AppleScript bridge only exist on macOS, so this gates
// the whole feature on the platform. Apple Music for Windows exposes no
// automation, so a track simply finishes in the output folder there.
export function shouldAddToAppleMusic(enabled: boolean, platform: NodeJS.Platform): boolean {
  return enabled && platform === 'darwin'
}

// Counts library tracks matching the given name and artist. AppleScript text
// comparison ignores case and diacritics by default, so this is forgiving on
// spelling while still requiring both fields to agree — a different song that
// shares a title with the release is not flagged as already present. Naming that
// diverges (e.g. "(Remix)" vs "- Remix") still misses, which is why the result
// is surfaced as a hint, not a guarantee.
export function buildLookupScript(artist: string, title: string): string {
  return [
    'tell application "Music"',
    `  set theHits to (every track of library playlist 1 whose name is ${JSON.stringify(title.trim())} and artist is ${JSON.stringify(artist.trim())})`,
    '  return (count of theHits)',
    'end tell',
  ].join('\n')
}

// Returns whether the song already exists in the user's Apple Music library.
// Mirrors addToAppleMusic in shelling out to osascript; the empty guard avoids a
// pointless query (and a match on every untitled track) before either field is
// filled. osascript prints the count followed by a newline.
export async function lookupInAppleMusic(artist: string, title: string): Promise<boolean> {
  if (!artist.trim() || !title.trim()) return false
  const { stdout } = await run('osascript', ['-e', buildLookupScript(artist, title)])
  return parseInt(stdout.trim(), 10) > 0
}

export async function addToAppleMusic(
  filePath: string,
  meta: TrackMetadata,
  coverPath?: string,
): Promise<void> {
  await run('osascript', ['-e', buildAddScript(filePath, meta, coverPath)])
}
