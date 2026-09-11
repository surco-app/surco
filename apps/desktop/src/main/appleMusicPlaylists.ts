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
    '  set out to {}',
    // Read one playlist at a time rather than three bulk property fetches. The names and
    // IDs would come back as lists, but `count of tracks of every user playlist` collapses
    // to a SINGLE number (measured against Music on macOS 26: it returns 0), so indexing
    // into it failed the whole dump with "Can't make item 1 of 0 into type Unicode text.
    // (-1700)". A per-playlist read is the only form that yields a count per row.
    '  repeat with p in userPlaylists',
    '    set end of out to (name of p) & tab & (count of tracks of p) & tab & (persistent ID of p)',
    '  end repeat',
    'end tell',
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
    '  set theList to item 1 of theLists',
    '  if (count of every track of theList) is 0 then return ""',
    // Two bulk property fetches rather than a round trip per track: measured against Music
    // on macOS 26, a 400-track playlist costs 14.34s read one track at a time and 1.39s
    // read this way, for an identical result. Unlike `count of tracks` (see the dump
    // script), these two really do return one item per track.
    //
    // A playlist mixes the user's own files with Apple Music streaming rows, which carry
    // no file at all: those come back as `missing value` here and become an empty path
    // below, so the caller can count them rather than never learn they existed.
    '  set theLocs to location of every track of theList',
    // The entry's identity travels with its file so a conversion can update THAT library
    // copy instead of adding a second one. Without it an imported track looks to Surco
    // like a file it has never seen, and converting it duplicates the song in Music.
    '  set thePids to persistent ID of every track of theList',
    'end tell',
    'set out to {}',
    'repeat with i from 1 to count of thePids',
    '  set loc to item i of theLocs',
    '  set p to ""',
    // POSIX path is a SYSTEM coercion, not one of Music's: performed inside the tell block
    // above it yields an empty string with no error, so every track read as "no file" and
    // a playlist of real files imported nothing. Measured against Music on macOS 26.
    '  if loc is not missing value then',
    '    try',
    '      set p to POSIX path of loc',
    '    end try',
    '  end if',
    '  set end of out to p & tab & (item i of thePids)',
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
  const seen = new Set<string>()
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
    // Two entries in Music can point at the same file (measured: a 982-track playlist held
    // 981 distinct paths). The import would dedupe them anyway and keep the first, so the
    // first entry's identity is the one kept here — taking the last would stamp the
    // surviving row with the ID of an entry that never made it into the list, and a later
    // conversion would update the wrong library copy.
    if (seen.has(path)) continue
    seen.add(path)
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
