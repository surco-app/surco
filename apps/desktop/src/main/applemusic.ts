import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import log from 'electron-log/main'
import type {
  AppleMusicLookupCandidate,
  MusicFileEntry,
  MusicFileLookup,
  MusicReviewEntry,
  MusicReviewField,
  OutputFormat,
  TrackMetadata,
} from '../shared/types'
import { createConcurrencyLimiter } from './analysisLimiter'

const run = promisify(execFile)

// osascript writes its real failure reason (e.g. "execution error: Music got an error:
// AppleEvent timed out. (-1712)") to stderr, but execFile's rejection message is
// "Command failed: osascript -e <the entire script>" — so surfacing err.message dumps
// the whole AppleScript at the user and hides the one line that explains what went wrong.
// This prefers stderr, leaving err.message only as a last resort.
function osascriptError(err: unknown): Error {
  const e = err as { stderr?: string; message?: string }
  const stderr = typeof e?.stderr === 'string' ? e.stderr.trim() : ''
  if (stderr) {
    // Drop osascript's "line:col:" prefix — it points into a script the user never wrote.
    return new Error(stderr.replace(/^\d+:\d+:\s*/, ''))
  }
  return err instanceof Error ? err : new Error(String(err))
}

export async function runOsascript(
  script: string,
  options?: { maxBuffer?: number },
): Promise<string> {
  try {
    const { stdout } = await run('osascript', ['-e', script], { encoding: 'utf8', ...options })
    return stdout
  } catch (err) {
    const failure = osascriptError(err)
    // The script goes to the log, never to the user: Music reports a failure by quoting its
    // own error ("Argument out of range: index must be less than -1") with no hint of which
    // statement raised it, and these scripts are assembled per track from the editor's
    // fields — so without the exact text that ran, the message names nothing to fix.
    log.error('osascript failed', failure.message, '\n--- script ---\n', script)
    throw failure
  }
}

// Apple Music imports one file at a time internally, and each add's osascript sits in a
// retry loop (up to 60s) waiting for that import to settle. Bulk conversions now run their
// ffmpeg in parallel, so several could reach the add at once and pile concurrent osascripts
// on Music — no faster (Music serializes them anyway) and prone to contention. This gate
// keeps the adds strictly one-at-a-time while the CPU-bound conversion work overlaps freely.
export const appleMusicLimiter = createConcurrencyLimiter(1)

function textFields(meta: TrackMetadata): [string, string][] {
  return [
    ['name', meta.title],
    ['artist', meta.artist],
    ['album artist', meta.albumArtist],
    ['album', meta.album],
    ['genre', meta.genre],
    ['grouping', meta.grouping],
    ['comment', meta.comment],
  ]
}

// bpm and disc number are the only advanced tags Music exposes to scripting;
// key/publisher/catalog/remixer live solely in the file tag.
function numericFields(meta: TrackMetadata): [string, string][] {
  return [
    ['year', meta.year],
    ['track number', meta.trackNumber],
    ['disc number', meta.discNumber],
    ['bpm', meta.bpm],
  ]
}

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
// re-raise any other error, and fail loud if it never becomes writable. The
// 600 tries × 0.1s give a 60s window: a 10s one was not enough for a large
// extended-mix AIFF copied into the library, which gave up and landed untagged.
export function buildAddScript(filePath: string, meta: TrackMetadata, coverPath?: string): string {
  const sets: string[] = []

  for (const [prop, value] of textFields(meta)) {
    if (value.trim()) sets.push(`      set ${prop} of theTrack to ${JSON.stringify(value)}`)
  }

  for (const [prop, value] of numericFields(meta)) {
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

  // macOS 26 (Tahoe) broke Music's `add`: it can execute without raising, import
  // nothing and return nothing. AppleScript then leaves theTrack UNDEFINED (a `set`
  // from a result-less command wipes the variable, even one pre-initialized to
  // missing value), so the first later reference aborted the whole script with the
  // cryptic "-2753 theTrack is not defined". The guard below detects both reported
  // variants — undefined and an explicit missing value — and, before giving up,
  // polls for the copy an async import may still have created (failing there would
  // push the user into a retry that imports a duplicate). The recovery matches by
  // the tags the converted file itself carries, bounded to entries added after this
  // run started so an older same-titled library copy is never adopted; without a
  // title and artist there is nothing safe to match, so the lookup is skipped and
  // the add fails straight to the clear error.
  const canRecover = !!meta.title.trim() && !!meta.artist.trim()
  const recovery = canRecover
    ? [
        '    if not gotTrack then',
        '      repeat 20 times',
        `        set theMatches to (every track of library playlist 1 whose name is ${JSON.stringify(meta.title)} and artist is ${JSON.stringify(meta.artist)} and date added is greater than or equal to importStarted)`,
        '        if (count of theMatches) > 0 then',
        '          set theTrack to item 1 of theMatches',
        '          set gotTrack to true',
        '          exit repeat',
        '        end if',
        '        delay 0.5',
        '      end repeat',
        '    end if',
      ]
    : []

  return [
    'tell application "Music"',
    // Importing a long extended-mix AIFF into the library, plus writing its artwork, can
    // outrun the default AppleEvent timeout (~120s) and abort with -1712 even though Music
    // is still working. Widen it so a slow import settles instead of the add failing on a
    // track that would have imported fine.
    '  with timeout of 300 seconds',
    // Two seconds of slack: date added has second resolution, and an import that
    // races the clock edge must still fall inside the recovery window.
    ...(canRecover ? ['    set importStarted to (current date) - 2'] : []),
    `    set theTrack to add POSIX file ${JSON.stringify(filePath)}`,
    '    set gotTrack to true',
    '    try',
    '      if theTrack is missing value then set gotTrack to false',
    '    on error',
    '      set gotTrack to false',
    '    end try',
    ...recovery,
    '    if not gotTrack then error "Música no importó el archivo y no dio ningún error: es un fallo conocido de macOS 26 (Tahoe). Reinicia la app Música (o el Mac) y vuelve a intentarlo."',
    '    set metaSet to false',
    '    repeat 600 times',
    '      try',
    ...sets.map((line) => `  ${line}`),
    '        set metaSet to true',
    '        exit repeat',
    '      on error errMsg number errNum',
    '        if errNum is not -50 then error errMsg number errNum',
    '        delay 0.1',
    '      end try',
    '    end repeat',
    '    if not metaSet then error "Apple Music no terminó de importar la pista a tiempo."',
    // The persistent ID is the only handle Music guarantees stable across sessions;
    // it travels back to the renderer so later edits update (or reveal) this exact
    // library copy instead of importing a duplicate.
    '    return persistent ID of theTrack',
    '  end timeout',
    'end tell',
  ].join('\n')
}

// Rewrites every field of an existing library track, located by the persistent ID the
// add returned. Unlike the add — a fresh import with nothing to clear — a sync must
// write empty values too: text cleared with "", numbers with 0 (Music displays both as
// empty), or a tag the user removed in the editor would linger in the library forever.
// When the user deleted the copy from Music the script returns "missing" instead of
// erroring, so the caller can fall back to a fresh add. No retry loop: the track is
// long settled, only a mid-import track raises the -50 the add has to ride out.
export function buildUpdateScript(
  persistentId: string,
  meta: TrackMetadata,
  coverPath?: string,
): string {
  const sets: string[] = []

  for (const [prop, value] of textFields(meta)) {
    sets.push(`  set ${prop} of theTrack to ${JSON.stringify(value.trim())}`)
  }

  for (const [prop, value] of numericFields(meta)) {
    const n = parseInt(value, 10)
    sets.push(`  set ${prop} of theTrack to ${Number.isFinite(n) && n > 0 ? n : 0}`)
  }

  if (coverPath?.trim()) {
    sets.push(
      `  set data of artwork 1 of theTrack to (read (POSIX file ${JSON.stringify(coverPath)}) as picture)`,
    )
  }

  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then return "missing"',
    '  set theTrack to item 1 of theMatches',
    ...sets,
    '  return persistent ID of theTrack',
    'end tell',
  ].join('\n')
}

// Where a library entry's file actually lives — read after an "Apple Music only" add
// so the caller can tell whether Music COPIED the file into its Media folder (safe to
// remove the temp conversion) or merely referenced the temp path ("Copy files to the
// Media folder" turned off — removing the temp would strand the entry). Empty string
// when the entry is gone or holds no reachable file.
// The alias leaves the tell block before POSIX path touches it. Coercing inside the block
// raises, the try swallows it, and the script returns empty for a track that is plainly
// in the library — measured 14/09, and the reason a replacement never told rekordbox
// which file it superseded.
export function buildLocationScript(persistentId: string): string {
  return [
    'set theLocation to missing value',
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is not 0 then',
    '    try',
    '      set theLocation to location of item 1 of theMatches',
    '    end try',
    '  end if',
    'end tell',
    'if theLocation is missing value then return ""',
    'return POSIX path of theLocation',
  ].join('\n')
}

export async function appleMusicEntryLocation(persistentId: string): Promise<string> {
  const stdout = await runOsascript(buildLocationScript(persistentId))
  return stdout.trim()
}

// Selects the library copy in the Music window and brings the app forward — the
// "show in Apple Music" counterpart of revealing a file in Finder. Erroring when the
// track is gone (rather than silently activating Music) lets the footer surface why
// nothing got selected.
export function buildRevealScript(persistentId: string): string {
  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then error "La pista ya no está en tu biblioteca de Apple Music."',
    '  reveal item 1 of theMatches',
    '  activate',
    'end tell',
  ].join('\n')
}

// Removes a library copy by persistent ID — the "replace the old rip" tail: once the
// freshly converted file is in the library, the copy it supersedes is deleted. Returns
// "missing" instead of erroring when the copy is already gone (the user beat us to it in
// Music), so the caller can treat that as done. The ID comes from a library snapshot
// whose whole-library fetches can misalign if Music mutates mid-dump, pairing the ID
// with the wrong song — so before deleting, the live track's own "artist - name" must
// equal the label the user confirmed in the dialog; anything else returns "mismatch"
// and deletes nothing. The file location is read BEFORE the delete (the track reference
// dies with it) and inside a try, because a dead reference — the file was moved or lives
// on an unmounted volume — reports missing value, and coercing that to POSIX path
// errors; such a copy must still delete, just with no file for the caller to trash.
// AppleScript's delete removes only the library entry and never touches the file, which
// is why the location travels back: trashing the superseded file is the caller's half
// of the job.
// With `location` (the list review, which found the entry by its file) the live entry must
// also still point at that file: the kept copy often carries the very same label.
export function buildDeleteScript(
  persistentId: string,
  expectedLabel: string,
  location?: string,
): string {
  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then return "missing"',
    '  set theTrack to item 1 of theMatches',
    `  if (artist of theTrack) & " - " & (name of theTrack) is not ${JSON.stringify(expectedLabel)} then return "mismatch"`,
    '  set loc to ""',
    '  try',
    '    set loc to POSIX path of (get location of theTrack)',
    '  end try',
    ...(location === undefined
      ? []
      : [
          '  considering case, diacriticals, hyphens, punctuation and white space',
          `    if loc is not ${JSON.stringify(location)} then return "mismatch"`,
          '  end considering',
        ]),
    '  delete theTrack',
    '  return "deleted" & tab & loc',
    'end tell',
  ].join('\n')
}

// Smart playlists recompute from their rules and refuse a manual add (-54), and folders
// hold no tracks, so only plain playlists are touched. The kept copy lands at the end of
// each one: Music offers no way to insert at a position, and the sheet says so.
// With `locations` (the list review) both live entries must also still point at their files.
export function buildPlaylistTransferScript(
  fromPid: string,
  toPid: string,
  expectedLabel: string,
  keepLabel: string,
  locations?: { from: string; to: string },
): string {
  return [
    'tell application "Music"',
    `  set srcs to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(fromPid)})`,
    `  set dsts to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(toPid)})`,
    '  if (count of srcs) is 0 or (count of dsts) is 0 then return "missing"',
    '  set src to item 1 of srcs',
    '  set dst to item 1 of dsts',
    `  if (artist of src) & " - " & (name of src) is not ${JSON.stringify(expectedLabel)} then return "mismatch"`,
    `  if (artist of dst) & " - " & (name of dst) is not ${JSON.stringify(keepLabel)} then return "mismatch"`,
    ...(locations === undefined
      ? []
      : [
          '  set srcLoc to ""',
          '  set dstLoc to ""',
          '  try',
          '    set srcLoc to POSIX path of (get location of src)',
          '  end try',
          '  try',
          '    set dstLoc to POSIX path of (get location of dst)',
          '  end try',
          '  considering case, diacriticals, hyphens, punctuation and white space',
          `    if srcLoc is not ${JSON.stringify(locations.from)} then return "mismatch"`,
          `    if dstLoc is not ${JSON.stringify(locations.to)} then return "mismatch"`,
          '  end considering',
        ]),
    '  set moved to 0',
    '  set failed to 0',
    '  repeat with p in (every user playlist whose smart is false and special kind is none)',
    '    try',
    `      if (exists (some track of p whose persistent ID is ${JSON.stringify(fromPid)})) and not (exists (some track of p whose persistent ID is ${JSON.stringify(toPid)})) then`,
    '        duplicate dst to (contents of p)',
    '        set moved to moved + 1',
    '      end if',
    '    on error',
    '      set failed to failed + 1',
    '    end try',
    '  end repeat',
    '  return (moved as text) & tab & (failed as text)',
    'end tell',
  ].join('\n')
}

export async function transferPlaylists(
  fromPid: string,
  toPid: string,
  expectedLabel: string,
  keepLabel: string,
  locations?: { from: string; to: string },
): Promise<string> {
  return (
    await runOsascript(
      buildPlaylistTransferScript(fromPid, toPid, expectedLabel, keepLabel, locations),
    )
  ).trim()
}

// osascript and the Music AppleScript bridge only exist on macOS, so this gates
// the whole feature on the platform. Apple Music for Windows exposes no
// automation, so a track simply finishes in the output folder there. FLAC is
// excluded on every platform because Apple Music cannot ingest it — adding the
// file would fail or import nothing, so a FLAC export always stays on disk.
export function shouldAddToAppleMusic(
  enabled: boolean,
  platform: NodeJS.Platform,
  format: OutputFormat,
): boolean {
  return enabled && platform === 'darwin' && format !== 'flac'
}

// "Apple Music only" mode: the track is added to Apple Music and no copy is kept in
// the output folder. The conversion still writes a real file (Apple Music imports a
// path), but it's written to a temp location and removed after the add. Requires the
// add to actually happen — when it can't (setting off, non-macOS, FLAC) the file must
// stay, so this returns false and the conversion keeps its output-folder copy. Never
// true for an in-place rewrite: that file is the user's own source, never deleted. Nor
// when Engine DJ registers the conversion: its library points at the output copy.
export function isAppleMusicOnly(
  addToAppleMusic: boolean,
  keepOutputCopy: boolean,
  addToEngineDj: boolean,
  platform: NodeJS.Platform,
  format: OutputFormat,
  inPlace: boolean,
): boolean {
  return (
    shouldAddToAppleMusic(addToAppleMusic, platform, format) &&
    !keepOutputCopy &&
    !addToEngineDj &&
    !inPlace
  )
}

// Dumps the whole library's name+artist+duration+persistent ID in one osascript so the
// renderer can match the crate against it locally — checking 282 tracks one lookup at a
// time would be 282 osascript spawns, each scanning the entire library. The fields are
// read as four lists (fast) and zipped into "name<tab>artist<tab>dur<tab>pid" lines via a
// list built with `set end of` (O(n)); concatenating a string in the loop would be O(n²)
// and stall on a multi-thousand-track library. Coercing the list to text with a linefeed
// delimiter gives one row per track. Duration feeds the version-aware matcher (a 6-minute
// mix vs an 8-minute one); the persistent ID names the matched entry, so an old copy the
// user is replacing can later be deleted instead of merely detected.
export function buildLibraryDumpScript(): string {
  return [
    'tell application "Music"',
    // An empty library is an ordinary state (a fresh Mac, a library whose external drive
    // is unplugged), but asking for a property of every track of one raises "Can't get
    // name of every track of library playlist 1. (-1728)": AppleScript will not coerce
    // the empty list. Measured on macOS 26.5.2, `count of tracks` returns 0 cleanly there
    // while `name of every track` throws, and `exists library playlist 1` is true either
    // way, so the count is the only thing that tells the two apart. Returning "" makes an
    // empty library parse as zero candidates instead of failing the whole snapshot, which
    // stripped every track of its "already in your library" verdict without saying why.
    '  if (count of tracks of library playlist 1) is 0 then return ""',
    '  set theNames to name of every track of library playlist 1',
    '  set theArtists to artist of every track of library playlist 1',
    '  set theDurations to duration of every track of library playlist 1',
    '  set thePids to persistent ID of every track of library playlist 1',
    'end tell',
    'set out to {}',
    'repeat with i from 1 to count of theNames',
    '  set end of out to (item i of theNames) & tab & (item i of theArtists) & tab & (item i of theDurations) & tab & (item i of thePids)',
    'end repeat',
    "set AppleScript's text item delimiters to linefeed",
    'return out as text',
  ].join('\n')
}

// A trailing numeric field — the duration AppleScript appends as seconds, which an
// es-locale serialises with a comma decimal ("486,55"). Anchored to the end so it only
// ever peels a real number off the last tab, never a tab the artist itself contains.
const TRAILING_DURATION = /\t(\d+(?:[.,]\d+)?)$/

// A trailing Music persistent ID — always 16 uppercase hex chars, so the pattern can't
// mistake an artist's own trailing text for one. Peeled before the duration, mirroring
// the dump's field order.
const TRAILING_PID = /\t([0-9A-F]{16})$/

// Parses the dump back into candidates. The title is everything up to the first tab; the
// persistent ID and duration, when the row ends in them, are peeled off the last tabs and
// the artist is what's left between — so an artist that itself holds a tab survives intact
// (its trailing fields match neither pattern, so nothing is peeled) and never gains a bogus
// duration or ID. Rows missing a title or artist are dropped — a trailing newline or empty
// field would otherwise become a pair that matches the whole crate; a missing/unparseable
// duration or ID just leaves the row a plainer candidate, never dropped.
export function parseLibraryDump(stdout: string): AppleMusicLookupCandidate[] {
  const pairs: AppleMusicLookupCandidate[] = []
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const title = line.slice(0, tab).trim()
    let rest = line.slice(tab + 1)
    let persistentId: string | undefined
    const pid = rest.match(TRAILING_PID)
    if (pid) {
      persistentId = pid[1]
      rest = rest.slice(0, pid.index)
    }
    let durationSec: number | undefined
    const dur = rest.match(TRAILING_DURATION)
    if (dur) {
      const sec = Math.round(Number(dur[1].replace(',', '.')))
      if (Number.isFinite(sec) && sec > 0) durationSec = sec
      rest = rest.slice(0, dur.index)
    }
    const artist = rest.trim()
    if (!title || !artist) continue
    const candidate: AppleMusicLookupCandidate = { title, artist }
    if (durationSec !== undefined) candidate.durationSec = durationSec
    if (persistentId) candidate.persistentId = persistentId
    pairs.push(candidate)
  }
  return pairs
}

export async function dumpAppleMusicLibrary(): Promise<AppleMusicLookupCandidate[]> {
  // maxBuffer: a large library's dump can exceed execFile's 1 MB default; ~64 MB holds
  // hundreds of thousands of "name<tab>artist" rows so the snapshot never truncates.
  const stdout = await runOsascript(buildLibraryDumpScript(), {
    maxBuffer: 64 * 1024 * 1024,
  })
  return parseLibraryDump(stdout)
}

const REVIEW_RS = '\u001e'
const REVIEW_FS = '\u001f'

// Music prints dates in the system locale, so the scripts send wall-clock seconds from a
// fixed local epoch as "days:seconds" (parseDateAdded) instead.
const ADDED_EPOCH = [
  'set epochRef to current date',
  'set year of epochRef to 2001',
  'set month of epochRef to January',
  'set day of epochRef to 1',
  'set time of epochRef to 0',
]
const ADDED_FIELD = [
  '  set added to ""',
  '  try',
  '    set x to (item i of theAdded) - epochRef',
  '    set added to ((x div 86400) as integer as text) & ":" & ((x mod 86400) as integer as text)',
  '  end try',
]

// The review reads the values to correct, so it uses control separators instead of the
// tabs and newlines the membership dump uses: a title can hold either, and losing or
// trimming a character here would hide exactly what the review exists to find.
export function buildReviewDumpScript(): string {
  const of = (prop: string) => `${prop} of every file track of library playlist 1`
  return [
    'tell application "Music"',
    '  if (count of file tracks of library playlist 1) is 0 then return ""',
    `  set thePids to ${of('persistent ID')}`,
    `  set theNames to ${of('name')}`,
    `  set theArtists to ${of('artist')}`,
    `  set theAlbumArtists to ${of('album artist')}`,
    `  set theAlbums to ${of('album')}`,
    `  set theGenres to ${of('genre')}`,
    `  set theDurations to ${of('duration')}`,
    `  set theAdded to ${of('date added')}`,
    'end tell',
    ...ADDED_EPOCH,
    'set RS to ASCII character 30',
    'set FS to ASCII character 31',
    'set out to {}',
    'repeat with i from 1 to count of thePids',
    ...ADDED_FIELD,
    '  set end of out to (item i of thePids) & FS & (item i of theNames) & FS & (item i of theArtists) & FS & (item i of theAlbumArtists) & FS & (item i of theAlbums) & FS & (item i of theGenres) & FS & (item i of theDurations) & FS & added',
    'end repeat',
    "set AppleScript's text item delimiters to RS",
    'return out as text',
  ].join('\n')
}

// AppleScript date arithmetic counts wall-clock seconds, so the offset is read as UTC fields
// and rebuilt as a local date; adding it to a local epoch would shift summer dates an hour.
function parseDateAdded(field: string): string | undefined {
  const m = /^(\d+):(\d+)$/.exec(field)
  if (!m) return undefined
  const wall = new Date(Date.UTC(2001, 0, 1) + (Number(m[1]) * 86400 + Number(m[2])) * 1000)
  return new Date(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
  ).toISOString()
}

export function parseReviewDump(stdout: string): MusicReviewEntry[] {
  const entries: MusicReviewEntry[] = []
  const body = stdout.replace(/\n$/, '')
  if (!body) return entries
  for (const row of body.split(REVIEW_RS)) {
    const fields = row.split(REVIEW_FS)
    if (fields.length !== 8) continue
    const [persistentId, title, artist, albumArtist, album, genre, duration, added] = fields
    if (!/^[0-9A-F]{16}$/.test(persistentId)) continue
    const entry: MusicReviewEntry = { persistentId, title, artist, albumArtist, album, genre }
    const sec = Math.round(Number(duration.replace(',', '.')))
    if (Number.isFinite(sec) && sec > 0) entry.durationSec = sec
    const dateAdded = parseDateAdded(added)
    if (dateAdded) entry.dateAdded = dateAdded
    entries.push(entry)
  }
  return entries
}

export async function dumpMusicReview(): Promise<MusicReviewEntry[]> {
  const stdout = await runOsascript(buildReviewDumpScript(), { maxBuffer: 64 * 1024 * 1024 })
  return parseReviewDump(stdout)
}

// Referring to the application outside a tell block does not launch it.
export function buildMusicRunningScript(): string {
  return 'return application "Music" is running'
}

// Reading `location` costs about 15 ms per track on an SMB-backed library (30 s for 2042
// tracks) while a bulk read of persistent ID, name or artist takes about 0.1 s each. So the
// names come first for every file track and the locations only for the few that matter.
export function buildFileNamesScript(): string {
  const of = (prop: string) => `${prop} of every file track of library playlist 1`
  return [
    'tell application "Music"',
    '  if (count of file tracks of library playlist 1) is 0 then return ""',
    `  set thePids to ${of('persistent ID')}`,
    `  set theArtists to ${of('artist')}`,
    `  set theNames to ${of('name')}`,
    `  set theAdded to ${of('date added')}`,
    'end tell',
    ...ADDED_EPOCH,
    'set RS to ASCII character 30',
    'set FS to ASCII character 31',
    'set out to {}',
    'repeat with i from 1 to count of thePids',
    ...ADDED_FIELD,
    '  set end of out to (item i of thePids) & FS & (item i of theArtists) & FS & (item i of theNames) & FS & added',
    'end repeat',
    "set AppleScript's text item delimiters to RS",
    'return out as text',
  ].join('\n')
}

// POSIX path is a system coercion, so it runs outside the tell block (see
// buildLocationScript). The wanted IDs are checked against the live list in the same pass,
// so a track added or removed since the names were read cannot shift the match.
export function buildFileLocationsScript(persistentIds: string[]): string {
  const wanted = `{${persistentIds.map((id) => JSON.stringify(id)).join(', ')}}`
  return [
    `set wanted to ${wanted}`,
    'set theLocs to {}',
    'tell application "Music"',
    '  set theTracks to every file track of library playlist 1',
    '  set thePids to persistent ID of every file track of library playlist 1',
    '  repeat with i from 1 to count of thePids',
    '    set theLoc to missing value',
    '    if wanted contains (item i of thePids) then',
    '      try',
    '        set theLoc to location of item i of theTracks',
    '      end try',
    '    end if',
    '    set end of theLocs to theLoc',
    '  end repeat',
    'end tell',
    'set RS to ASCII character 30',
    'set FS to ASCII character 31',
    'set out to {}',
    'repeat with i from 1 to count of thePids',
    '  set loc to item i of theLocs',
    '  if loc is not missing value then',
    '    try',
    '      set end of out to (item i of thePids) & FS & (POSIX path of loc)',
    '    end try',
    '  end if',
    'end repeat',
    "set AppleScript's text item delimiters to RS",
    'return out as text',
  ].join('\n')
}

type FileName = { persistentId: string; name: string; label: string; dateAdded?: string }

export function parseFileNames(stdout: string): FileName[] {
  const rows: FileName[] = []
  const body = stdout.replace(/\n$/, '')
  if (!body) return rows
  for (const line of body.split(REVIEW_RS)) {
    const fields = line.split(REVIEW_FS)
    if (fields.length !== 4) continue
    const [persistentId, artist, name, added] = fields
    if (!/^[0-9A-F]{16}$/.test(persistentId)) continue
    const dateAdded = parseDateAdded(added)
    rows.push({ persistentId, name, label: `${artist} - ${name}`, ...(dateAdded && { dateAdded }) })
  }
  return rows
}

export function parseFileLocations(stdout: string): { persistentId: string; path: string }[] {
  const rows: { persistentId: string; path: string }[] = []
  const body = stdout.replace(/\n$/, '')
  if (!body) return rows
  for (const line of body.split(REVIEW_RS)) {
    const fields = line.split(REVIEW_FS)
    if (fields.length !== 2) continue
    const [persistentId, path] = fields
    if (!/^[0-9A-F]{16}$/.test(persistentId) || !path) continue
    rows.push({ persistentId, path })
  }
  return rows
}

export function entriesForPaths(
  rows: ({ path: string } & MusicFileEntry)[],
  paths: string[],
): Record<string, MusicFileEntry[]> {
  const byPath = new Map<string, MusicFileEntry[]>()
  for (const { path, ...entry } of rows) {
    const key = path.normalize('NFC')
    byPath.set(key, [...(byPath.get(key) ?? []), entry])
  }
  const out: Record<string, MusicFileEntry[]> = {}
  for (const path of paths) {
    const found = byPath.get(path.normalize('NFC'))
    if (found) out[path] = found
  }
  return out
}

const nameKey = (text: string) => text.normalize('NFC').trim().toLowerCase()

// A Music track whose name differs from the file's title tag (beyond case and surrounding
// spaces, which is what the review fixes) is not found, so the file counts as not in Music.
// That fails safe: nothing in Music is updated or removed for it.
export async function musicFileEntries(
  candidates: { path: string; title: string }[],
  launch: boolean,
  run: typeof runOsascript = runOsascript,
): Promise<MusicFileLookup> {
  try {
    if (!launch && (await run(buildMusicRunningScript())).trim() !== 'true')
      return { consulted: false, entries: {} }
    const titles = new Set(candidates.map((c) => nameKey(c.title)))
    const names = parseFileNames(
      await run(buildFileNamesScript(), { maxBuffer: 64 * 1024 * 1024 }),
    ).filter((r) => titles.has(nameKey(r.name)))
    if (names.length === 0) return { consulted: true, entries: {} }
    const byPid = new Map(names.map(({ name, ...entry }) => [entry.persistentId, entry]))
    const located = parseFileLocations(
      await run(buildFileLocationsScript(names.map((r) => r.persistentId)), {
        maxBuffer: 64 * 1024 * 1024,
      }),
    ).flatMap((r) => {
      const entry = byPid.get(r.persistentId)
      return entry ? [{ ...entry, path: r.path }] : []
    })
    return {
      consulted: true,
      entries: entriesForPaths(
        located,
        candidates.map((c) => c.path),
      ),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('-1728')) return { consulted: true, entries: {} }
    log.warn('Music file lookup failed', message)
    return { consulted: false, entries: {} }
  }
}

// Every file track and its file, read before the list review trashes a file: the title
// lookup misses a track renamed in Music. Measured 09/10 on a 2045-track SMB library:
// `whose location is` never matched a real path and still took 35-45 s, one track at a
// time 102 s, these bulk lists 47 s with pairs identical to the one-at-a-time read. The
// lists pair by position, so a library that changed in between fails the read. The script
// tells an empty library apart itself (see buildLibraryDumpScript): every failure, -1728
// included, reaches the caller, which keeps the file. The 120 s Apple Event default
// (-1712) would make a large library keep every file without saying why.
export function buildFileLocationsAllScript(): string {
  return [
    'tell application "Music"',
    '  if (count of file tracks of library playlist 1) is 0 then return ""',
    '  with timeout of 600 seconds',
    '    set pidsBefore to persistent ID of every file track of library playlist 1',
    '    set theLocs to location of every file track of library playlist 1',
    '    set pidsAfter to persistent ID of every file track of library playlist 1',
    '  end timeout',
    'end tell',
    'if pidsBefore is not pidsAfter then return "changed"',
    'set out to {}',
    'repeat with i from 1 to count of pidsBefore',
    '  try',
    '    set end of out to (item i of pidsBefore) & (ASCII character 31) & (POSIX path of (item i of theLocs))',
    '  end try',
    'end repeat',
    `set AppleScript's text item delimiters to (ASCII character 30)`,
    'return out as text',
  ].join('\n')
}

export async function musicFileLocations(
  run: typeof runOsascript = runOsascript,
): Promise<{ persistentId: string; path: string }[]> {
  const stdout = await run(buildFileLocationsAllScript(), { maxBuffer: 64 * 1024 * 1024 })
  if (stdout.trim() === 'changed') throw new Error('music-library-changed')
  return parseFileLocations(stdout)
}

export type MusicSetResult = 'set' | 'missing' | 'mismatch'

const MUSIC_PROPERTY: Record<MusicReviewField, string> = {
  title: 'name',
  artist: 'artist',
  albumArtist: 'album artist',
  album: 'album',
  genre: 'genre',
}

export function buildSetFieldScript(
  persistentId: string,
  field: MusicReviewField,
  from: string,
  to: string,
  location?: string,
): string {
  const prop = MUSIC_PROPERTY[field]
  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then return "missing"',
    '  set theTrack to item 1 of theMatches',
    ...(location === undefined
      ? []
      : [
          '  set theLoc to ""',
          '  try',
          '    set theLoc to POSIX path of (get location of theTrack)',
          '  end try',
        ]),
    '  considering case, diacriticals, hyphens, punctuation and white space',
    ...(location === undefined
      ? []
      : [`    if theLoc is not ${JSON.stringify(location)} then return "mismatch"`]),
    `    if (${prop} of theTrack) is not ${JSON.stringify(from)} then return "mismatch"`,
    '  end considering',
    `  set ${prop} of theTrack to ${JSON.stringify(to)}`,
    '  return "set"',
    'end tell',
  ].join('\n')
}

export async function setAppleMusicField(
  persistentId: string,
  field: MusicReviewField,
  from: string,
  to: string,
  location?: string,
): Promise<MusicSetResult> {
  const result = (
    await runOsascript(buildSetFieldScript(persistentId, field, from, to, location))
  ).trim()
  if (result === 'set' || result === 'missing' || result === 'mismatch') return result
  throw new Error(`unexpected Music answer: ${result}`)
}

export async function addToAppleMusic(
  filePath: string,
  meta: TrackMetadata,
  coverPath?: string,
): Promise<string> {
  const stdout = await runOsascript(buildAddScript(filePath, meta, coverPath))
  return stdout.trim()
}

// null means the library copy is gone (the script's "missing"): the caller decides
// whether that warrants a fresh add or an error to the user.
export async function updateInAppleMusic(
  persistentId: string,
  meta: TrackMetadata,
  coverPath?: string,
): Promise<string | null> {
  const stdout = await runOsascript(buildUpdateScript(persistentId, meta, coverPath))
  const result = stdout.trim()
  return result === 'missing' ? null : result
}

export async function revealInAppleMusic(persistentId: string): Promise<void> {
  await runOsascript(buildRevealScript(persistentId))
}

// null means the copy was already gone; otherwise the deleted entry's file path, ''
// when Music held no reachable file for it. A "mismatch" (the live track no longer
// carries the confirmed label — a stale/misaligned snapshot) throws with a sentinel the
// renderer recognizes across the IPC boundary, so it can say nothing was deleted.
export async function deleteFromAppleMusic(
  persistentId: string,
  expectedLabel: string,
  location?: string,
): Promise<string | null> {
  const stdout = await runOsascript(buildDeleteScript(persistentId, expectedLabel, location))
  const result = stdout.trim()
  if (result === 'missing') return null
  if (result === 'mismatch') throw new Error('applemusic-delete-mismatch')
  return result.split('\t')[1] ?? ''
}
