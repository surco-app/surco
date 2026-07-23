import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppleMusicLookupCandidate, OutputFormat, TrackMetadata } from '../shared/types'
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

async function runOsascript(script: string, options?: { maxBuffer?: number }): Promise<string> {
  try {
    const { stdout } = await run('osascript', ['-e', script], { encoding: 'utf8', ...options })
    return stdout
  } catch (err) {
    throw osascriptError(err)
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
export function buildLocationScript(persistentId: string): string {
  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then return ""',
    '  try',
    '    return POSIX path of (location of item 1 of theMatches)',
    '  end try',
    '  return ""',
    'end tell',
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
export function buildDeleteScript(persistentId: string, expectedLabel: string): string {
  return [
    'tell application "Music"',
    `  set theMatches to (every track of library playlist 1 whose persistent ID is ${JSON.stringify(persistentId)})`,
    '  if (count of theMatches) is 0 then return "missing"',
    '  set theTrack to item 1 of theMatches',
    `  if (artist of theTrack) & " - " & (name of theTrack) is not ${JSON.stringify(expectedLabel)} then return "mismatch"`,
    '  set loc to ""',
    '  try',
    '    set loc to POSIX path of (location of theTrack)',
    '  end try',
    '  delete theTrack',
    '  return "deleted" & tab & loc',
    'end tell',
  ].join('\n')
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
// true for an in-place rewrite: that file is the user's own source, never deleted.
export function isAppleMusicOnly(
  addToAppleMusic: boolean,
  keepOutputCopy: boolean,
  platform: NodeJS.Platform,
  format: OutputFormat,
  inPlace: boolean,
): boolean {
  return shouldAddToAppleMusic(addToAppleMusic, platform, format) && !keepOutputCopy && !inPlace
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
): Promise<string | null> {
  const stdout = await runOsascript(buildDeleteScript(persistentId, expectedLabel))
  const result = stdout.trim()
  if (result === 'missing') return null
  if (result === 'mismatch') throw new Error('applemusic-delete-mismatch')
  return result.split('\t')[1] ?? ''
}
