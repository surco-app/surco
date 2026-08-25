import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The exact binary name is unverified — there's no Traktor install to check against,
// and it has varied across releases ("Traktor", "Traktor Pro", "Traktor Pro 4"). A
// pgrep -x on a guessed name would silently never match if we guessed wrong, which is
// the exact failure this guard exists to prevent. So we match "Traktor" as a substring
// (pgrep's default without -x, case-insensitive) instead of demanding one exact string.
const NAME_PATTERN = 'traktor'

// Whether the Traktor app is running. Traktor loads collection.nml into memory once at
// launch and rewrites the whole file on quit, with no lock or on-disk marker while it
// runs — so no artifact reliably says "in use" while it idles. The process itself is
// the signal: writing collection.nml under a live Traktor loses whichever side saves
// last, and Traktor always wins because it saves on exit regardless of what's on disk.
export async function isTraktorRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq Traktor*', '/NH'])
      return /traktor/i.test(stdout)
    }
    await run('pgrep', ['-i', NAME_PATTERN])
    return true
  } catch {
    // pgrep exits non-zero when nothing matches; a missing tool also means "can't
    // tell", where blocking every sync would be worse than proceeding.
    return false
  }
}

// Asks Traktor to quit the polite way, then waits for the process to actually
// disappear — writing collection.nml while Traktor is mid-shutdown would be the exact
// race the guard exists for. The unverified app name (see NAME_PATTERN above) rules out
// `tell application "Traktor" to quit`, which needs the name spelled exactly; instead
// we ask System Events for whichever running process name contains "traktor" and quit
// that. Returns whether Traktor is gone; a quit refused (unsaved dialog, hang) is false.
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
        `tell application "System Events" to set matches to name of every process whose name contains "Traktor"`,
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
