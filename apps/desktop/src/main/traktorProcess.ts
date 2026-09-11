import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The exact binary name is unverified — there's no Traktor install to check against,
// and it has varied across releases ("Traktor", "Traktor Pro", "Traktor Pro 4"). A
// pgrep -x on a guessed name would silently never match if we guessed wrong, which is
// the exact failure this guard exists to prevent. But a bare substring match is too
// wide in the other direction: it also matches the helper tools DJs run alongside
// Traktor (TraktorCueGridInspector and the like), and then the guard blocks a sync with
// Traktor closed. So the name must *start* with Traktor and then either end or carry on
// after a space — every release name qualifies, a helper's run-on name does not.
const NAME_PATTERN = '^traktor( |$)'

// Whether the Traktor app is running. Traktor loads collection.nml into memory once at
// launch and rewrites the whole file on quit, with no lock or on-disk marker while it
// runs — so no artifact reliably says "in use" while it idles. The process itself is
// the signal: writing collection.nml under a live Traktor loses whichever side saves
// last, and Traktor always wins because it saves on exit regardless of what's on disk.
// pgrep's documented exit status: 1 means "no processes matched", which is a real
// answer. Anything else — 2 for a syntax error, 3 for a fatal one, ENOENT for a missing
// binary, a timeout — means the question went unanswered.
function meansNoMatch(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 1
}

export async function isTraktorRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq Traktor*', '/NH'])
      // The filter is as narrow as tasklist gets, and it has no word boundary: the helper
      // tools DJs run alongside Traktor come back in this listing too. Applying
      // NAME_PATTERN's rule to the image name keeps "Traktor.exe" and "Traktor Pro 4.exe"
      // and drops "TraktorCueGridInspector.exe".
      return /^traktor( |\.exe)/im.test(stdout)
    }
    await run('pgrep', ['-i', NAME_PATTERN])
    return true
  } catch (err) {
    // Only pgrep's "nothing matched" counts as Traktor being closed. Every other failure
    // means we could not find out, and the two answers are not equally safe: Traktor
    // rewrites collection.nml wholesale when it quits, so a write underneath a live
    // Traktor is discarded without an error anywhere — the cues, grid and artwork just
    // synced are silently gone. Reporting "running" when we cannot tell costs one skipped
    // sync the user is told about; reporting "not running" costs their work.
    if (process.platform !== 'win32' && meansNoMatch(err)) return false
    return true
  }
}

// Asks Traktor to quit the polite way, then waits for the process to actually
// disappear — writing collection.nml while Traktor is mid-shutdown would be the exact
// race the guard exists for. The unverified app name (see NAME_PATTERN above) rules out
// `tell application "Traktor" to quit`, which needs the name spelled exactly; instead we
// ask System Events for the running processes whose name Traktor's own releases could
// have, matching NAME_PATTERN's rule rather than a bare "contains": a quit aimed at a
// helper tool made macOS put up a "Where is <tool>?" locate dialog for an app the user
// never asked to close. Returns whether Traktor is gone; a refused quit is false.
export async function quitTraktor(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // taskkill accepts the wildcard for /IM "only when a filter is applied", so
      // `/IM Traktor*.exe` alone is rejected — the catch below would swallow that and
      // the poll would spend its full 15 s waiting for a quit nothing ever requested.
      // The documented shape carries the pattern in the filter and a bare * in /IM.
      // Still no /F: this is the polite quit that lets Traktor save its collection.
      await run('taskkill', ['/FI', 'IMAGENAME eq Traktor*', '/IM', '*'])
    } else {
      await run('osascript', [
        '-e',
        `tell application "System Events" to set matches to name of every process whose name is "Traktor" or name starts with "Traktor "`,
        '-e',
        'repeat with appName in matches',
        '-e',
        'tell application appName to quit',
        '-e',
        'end repeat',
      ])
    }
  } catch {
    // The quit event failing outright (app already gone, tool missing) resolves by
    // whatever the poll below observes.
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await isTraktorRunning())) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}
