import { execFile } from 'node:child_process'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

// Which imported tracks still need their cover, and fetching it from Apple Music.
//
// Music holds artwork for tracks whose files carry none — measured on a real library, 53%
// of it, almost all WAVs — so a playlist import showed half its rows with an empty cover
// slot even though the picture was right there in Music.
//
// Only the files without their own picture are asked for: the other half already carry
// full-resolution art, and re-fetching it would be work for nothing.

export interface ImportedTrack {
  path: string
  // Absent for a track that did not come from a playlist import, which leaves no library
  // entry to fetch the art from.
  persistentId?: string
}

export interface MissingArtworkDeps {
  hasEmbedded: (path: string) => Promise<boolean>
}

// Where fetched covers live: the app's own data folder, never the user's music. They are
// a cache of something Music already holds, so losing them costs one re-fetch.
export async function artworkDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'applemusic-artwork')
  await mkdir(dir, { recursive: true })
  return dir
}

// Runs the script and reports which files really landed. A track whose artwork vanished
// between the listing and the fetch writes nothing, and the caller must not hand on a path
// that was never created.
export async function fetchAppleMusicArtwork(
  jobs: { persistentId: string; outPath: string }[],
): Promise<{ path: string; dataUrl: string }[]> {
  // The raw data of a few hundred covers can outgrow execFile's 1 MB default; the pictures
  // themselves land in files, but osascript's own output still has to fit.
  await promisify(execFile)('osascript', ['-e', buildArtworkScript(jobs)], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const landed = await Promise.all(
    jobs.map(async ({ outPath }) => {
      try {
        // A zero-byte file is a write that opened and never finished; treating it as a
        // cover would show a broken image instead of the empty slot it replaced.
        if ((await stat(outPath)).size === 0) return null
        // The sandboxed renderer cannot load a file:// image, so the picture travels as a
        // data URL too — the path is only what a later conversion embeds.
        const bytes = await readFile(outPath)
        return { path: outPath, dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` }
      } catch {
        return null
      }
    }),
  )
  return landed.filter((cover): cover is { path: string; dataUrl: string } => cover !== null)
}

// Fetches each track's picture into its own file.
//
// One track at a time rather than a single block read: asking Music for a property of a
// whole track list works for text, but `location` already proved it fails outright over a
// list (-1728), and artwork is raw binary that has to land in a file per track anyway.
// Measured on the real library: 40 tracks in 2 seconds, 39 of them with art.
//
// Each track gets its own try block, so one whose artwork vanished between the listing and
// the fetch costs its own cover and not the rest of the batch.
export function buildArtworkScript(jobs: { persistentId: string; outPath: string }[]): string {
  // A quote would close the string and turn the rest of the path into code — the same
  // class of bug as a dollar sign in a Traktor file name.
  const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const body = jobs.flatMap(({ persistentId, outPath }) => [
    '  try',
    `    set theMatches to (every track of library playlist 1 whose persistent ID is ${quote(persistentId)})`,
    '    if (count of theMatches) > 0 then',
    '      set theTrack to item 1 of theMatches',
    '      if (count of artworks of theTrack) > 0 then',
    '        set theData to raw data of artwork 1 of theTrack',
    `        set theFile to (open for access ${quote(outPath)} with write permission)`,
    '        set eof theFile to 0',
    '        write theData to theFile',
    '        close access theFile',
    '      end if',
    '    end if',
    '  on error',
    // The handle stays open if the failure landed between open and close, and a leaked
    // one blocks every later write to that path.
    '    try',
    '      close access theFile',
    '    end try',
    '  end try',
  ])
  return ['tell application "Music"', ...body, 'end tell'].join('\n')
}

export async function missingArtwork(
  tracks: ImportedTrack[],
  deps: MissingArtworkDeps,
): Promise<Required<ImportedTrack>[]> {
  const need: Required<ImportedTrack>[] = []
  for (const track of tracks) {
    if (!track.persistentId) continue
    try {
      if (await deps.hasEmbedded(track.path)) continue
    } catch {
      // A file that cannot be probed is left alone: fetching art for a track whose own
      // state is unknown risks stamping a picture onto something that already had one.
      continue
    }
    need.push({ path: track.path, persistentId: track.persistentId })
  }
  return need
}
