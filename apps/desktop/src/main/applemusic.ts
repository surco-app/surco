import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppleMusicLookupCandidate, OutputFormat, TrackMetadata } from '../shared/types'

const run = promisify(execFile)

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

  return [
    'tell application "Music"',
    `  set theTrack to add POSIX file ${JSON.stringify(filePath)}`,
    '  set metaSet to false',
    '  repeat 600 times',
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
    // The persistent ID is the only handle Music guarantees stable across sessions;
    // it travels back to the renderer so later edits update (or reveal) this exact
    // library copy instead of importing a duplicate.
    '  return persistent ID of theTrack',
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

// Keeps only the candidates worth asking the library about: a pair missing either
// side can't identify a song (and an empty artist would `contains ""`-match the
// entire library), and pairs that collapse to the same trimmed title and primary
// artist are one question — once a Discogs match is applied the tags equal the
// suggestion, so without the dedupe every lookup would ask Music twice. The key is
// lowercased because AppleScript compares text case-insensitively.
export function lookupCandidates(
  candidates: AppleMusicLookupCandidate[],
): AppleMusicLookupCandidate[] {
  const seen = new Set<string>()
  const kept: AppleMusicLookupCandidate[] = []
  for (const candidate of candidates) {
    const title = candidate.title.trim().toLowerCase()
    const artist = candidate.artist.split(',')[0].trim().toLowerCase()
    if (!title || !artist) continue
    const key = `${title}\n${artist}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(candidate)
  }
  return kept
}

// Counts library tracks matching any candidate: the name exactly and the primary
// artist loosely. We match the artist with `contains` against only the first
// comma-separated name because our tags join collaborators ("Alfredo Pareja,
// Saint Etien") while Apple Music stores just the primary artist ("Alfredo
// Pareja") — an exact `artist is` flagged every feat./multi-artist track as not
// in the library when it was. AppleScript text comparison ignores case and
// diacritics by default, so this is also forgiving on spelling while the exact
// title keeps a different song that shares the primary artist from matching.
// The candidates (the live tags, plus the Discogs-suggested track when one is on
// screen) are ORed into a single query so the lookup costs one osascript spawn
// either way. Naming that diverges from every candidate (e.g. "(Remix)" vs
// "- Remix") still misses, which is why the result is surfaced as a hint, not a
// guarantee.
export function buildLookupScript(candidates: AppleMusicLookupCandidate[]): string {
  const clauses = candidates.map(({ artist, title }) => {
    const primaryArtist = artist.split(',')[0].trim()
    return `(name is ${JSON.stringify(title.trim())} and artist contains ${JSON.stringify(primaryArtist)})`
  })
  return [
    'tell application "Music"',
    `  set theHits to (every track of library playlist 1 whose ${clauses.join(' or ')})`,
    '  return (count of theHits)',
    'end tell',
  ].join('\n')
}

// Returns whether the song already exists in the user's Apple Music library.
// Mirrors addToAppleMusic in shelling out to osascript; the empty result guard
// avoids a pointless query (and a match on every untitled track) before any
// candidate is filled. osascript prints the count followed by a newline.
export async function lookupInAppleMusic(
  candidates: AppleMusicLookupCandidate[],
): Promise<boolean> {
  const complete = lookupCandidates(candidates)
  if (complete.length === 0) return false
  const { stdout } = await run('osascript', ['-e', buildLookupScript(complete)])
  return parseInt(stdout.trim(), 10) > 0
}

export async function addToAppleMusic(
  filePath: string,
  meta: TrackMetadata,
  coverPath?: string,
): Promise<string> {
  const { stdout } = await run('osascript', ['-e', buildAddScript(filePath, meta, coverPath)])
  return stdout.trim()
}

// null means the library copy is gone (the script's "missing"): the caller decides
// whether that warrants a fresh add or an error to the user.
export async function updateInAppleMusic(
  persistentId: string,
  meta: TrackMetadata,
  coverPath?: string,
): Promise<string | null> {
  const { stdout } = await run('osascript', [
    '-e',
    buildUpdateScript(persistentId, meta, coverPath),
  ])
  const result = stdout.trim()
  return result === 'missing' ? null : result
}

export async function revealInAppleMusic(persistentId: string): Promise<void> {
  await run('osascript', ['-e', buildRevealScript(persistentId)])
}
