// Reading a playlist as a source of tracks, the counterpart to the write side in
// applemusic.ts. Only the user's own playlists are offered: the library itself is not a
// crate anyone picks to work on, and the smart playlists Music ships with ("Recently
// Added", "Top 25 Most Played") are queries, not selections.
import type { AppleMusicPlaylist, AppleMusicPlaylistTracks } from '../shared/types'
import { runOsascript } from './applemusic'

export function buildPlaylistDumpScript(): string {
  return [
    'tell application "Music"',
    '  set userPlaylists to every user playlist',
    // Same guard buildLibraryDumpScript needs: AppleScript will not coerce an empty
    // list, so asking for a property of every item of one raises -1728 and would fail
    // the whole dialog on a library with no playlists instead of opening it empty.
    '  if (count of userPlaylists) is 0 then return ""',
    '  set theNames to name of every user playlist',
    '  set theCounts to count of tracks of every user playlist',
    '  set thePids to persistent ID of every user playlist',
    'end tell',
    'set out to {}',
    'repeat with i from 1 to count of theNames',
    '  set end of out to (item i of theNames) & tab & (item i of theCounts) & tab & (item i of thePids)',
    'end repeat',
    "set AppleScript's text item delimiters to linefeed",
    'return out as text',
  ].join('\n')
}

// Trailing fields are peeled off the end, never split left to right: a playlist name is
// user-typed and can hold a tab, and splitting would truncate the name and read the rest
// of it as the count. Same reasoning as parseLibraryDump.
const TRAILING_PID = /\t([0-9A-F]{16})$/
const TRAILING_COUNT = /\t(\d+)$/

export function parsePlaylistDump(stdout: string): AppleMusicPlaylist[] {
  const rows: AppleMusicPlaylist[] = []
  for (const line of stdout.split('\n')) {
    const pid = line.match(TRAILING_PID)
    if (!pid) continue
    const rest = line.slice(0, pid.index)
    const cnt = rest.match(TRAILING_COUNT)
    if (!cnt) continue
    const name = rest.slice(0, cnt.index).trim()
    if (!name) continue
    rows.push({ name, count: Number(cnt[1]), persistentId: pid[1] })
  }
  return rows
}

export async function dumpAppleMusicPlaylists(): Promise<AppleMusicPlaylist[]> {
  const stdout = await runOsascript(buildPlaylistDumpScript(), {
    maxBuffer: 8 * 1024 * 1024,
  })
  return parsePlaylistDump(stdout)
}

// The playlist is re-found by persistent ID rather than by the name the dialog showed:
// the user can rename or delete it in Music between opening the dialog and importing,
// and a name lookup would then load the wrong crate or nothing at all.
export function buildPlaylistTracksScript(persistentId: string): string {
  return [
    'tell application "Music"',
    `  set theLists to (every user playlist whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theLists) is 0 then return ""',
    '  set theTracks to every track of item 1 of theLists',
    '  if (count of theTracks) is 0 then return ""',
    'end tell',
    'set out to {}',
    'repeat with t in theTracks',
    // A playlist mixes the user's own files with Apple Music streaming tracks, which
    // carry no file: `location` raises on those, and an unguarded read would abort an
    // import of a hundred real files over one streaming row. An empty line stands for
    // "no file" so the caller can count them rather than never learn they existed.
    '  set loc to ""',
    '  set pid to ""',
    '  try',
    '    tell application "Music" to set loc to POSIX path of (location of t)',
    '  end try',
    // The entry's identity travels with its file so a conversion can update THAT library
    // copy instead of adding a second one. Without it an imported track looks to Surco
    // like a file it has never seen, and converting it duplicates the song in Music.
    '  try',
    '    tell application "Music" to set pid to persistent ID of t',
    '  end try',
    '  set end of out to loc & tab & pid',
    'end repeat',
    "set AppleScript's text item delimiters to linefeed",
    'return out as text',
  ].join('\n')
}

// The missing count is carried rather than dropped in silence: a user who counts 128 in
// Music and sees 122 rows here cannot tell which six are missing or why, and that gap is
// exactly what arrives later as a bug report with no way to reproduce it.
// The persistent ID is peeled off the END of the line, never split left to right: a file
// name can hold a tab, and splitting would truncate the path and read the rest of it as
// an ID. Same reasoning as parseLibraryDump's trailing fields.
const TRAILING_TRACK_PID = /\t([0-9A-F]{16})?$/

export function parsePlaylistTracks(stdout: string): AppleMusicPlaylistTracks {
  const paths: string[] = []
  const persistentIds: Record<string, string> = {}
  let missing = 0
  // A trailing newline is the delimiter's, not a track's: trimming the end first keeps it
  // from counting as a track with no file.
  const body = stdout.replace(/\n+$/, '')
  if (!body) return { paths, persistentIds, missing }
  for (const line of body.split('\n')) {
    const pid = line.match(TRAILING_TRACK_PID)
    const path = (pid ? line.slice(0, pid.index) : line).trim()
    if (!path) {
      missing += 1
      continue
    }
    paths.push(path)
    if (pid?.[1]) persistentIds[path] = pid[1]
  }
  return { paths, persistentIds, missing }
}

export async function readAppleMusicPlaylist(
  persistentId: string,
): Promise<AppleMusicPlaylistTracks> {
  const stdout = await runOsascript(buildPlaylistTracksScript(persistentId), {
    maxBuffer: 64 * 1024 * 1024,
  })
  return parsePlaylistTracks(stdout)
}
