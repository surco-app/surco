import { execFile } from 'child_process'
import { promisify } from 'util'
import { TrackMetadata } from '../shared/types'

const run = promisify(execFile)

// Adds a file to Apple Music and writes every field directly onto the resulting
// track via AppleScript. We don't rely on Apple Music reading the AIFF tags,
// because it ignores several of them (year, grouping) — setting the track
// properties explicitly guarantees the library shows exactly what was edited,
// which is the whole point of the app. If "Copy files to Music Media folder"
// is enabled, the file is copied into the library too.
export async function addToAppleMusic(filePath: string, meta: TrackMetadata): Promise<void> {
  const lines = [`set theTrack to add POSIX file ${JSON.stringify(filePath)}`]

  const text: [string, string][] = [
    ['name', meta.title],
    ['artist', meta.artist],
    ['album artist', meta.albumArtist],
    ['album', meta.album],
    ['genre', meta.genre],
    ['grouping', meta.grouping],
    ['comment', meta.comment]
  ]
  for (const [prop, value] of text) {
    if (value.trim()) lines.push(`set ${prop} of theTrack to ${JSON.stringify(value)}`)
  }

  const numeric: [string, string][] = [
    ['year', meta.year],
    ['track number', meta.trackNumber]
  ]
  for (const [prop, value] of numeric) {
    const n = parseInt(value, 10)
    if (Number.isFinite(n) && n > 0) lines.push(`set ${prop} of theTrack to ${n}`)
  }

  const script = `tell application "Music"\n${lines.join('\n')}\nend tell`
  await run('osascript', ['-e', script])
}
