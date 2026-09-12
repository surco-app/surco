import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The main application binary. The app bundle also ships rekordboxAgent and
// "Upmgr rekordbox", both of which start with this name and can outlive the app itself,
// so every probe below matches the whole name and never a substring: a wider match would
// report "open" while the app is closed and silently refuse every write, and a quit aimed
// at a helper is how Traktor's guard once made macOS ask the user to locate a tool they
// never launched.
const PROCESS_NAME = 'rekordbox'

// Whether rekordbox is running. It holds master.db open through SQLCipher for as long as
// the app is up, so writing underneath it risks both losing the write and corrupting a
// file the user cannot rebuild. There is no lock or marker on disk that reliably says
// "in use" while the app idles, so the process itself is the signal.
//
// Unanswerable is treated as running, and the asymmetry is deliberate: answering "closed"
// wrongly writes into a live collection, while answering "running" wrongly costs one
// skipped sync the user is told about. The Traktor side of this project has had that
// backwards twice.
export async function isRekordboxRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', `IMAGENAME eq ${PROCESS_NAME}.exe`, '/NH'])
      // The filter is as narrow as tasklist gets and still has no word boundary, so the
      // helpers appear in this listing too. Requiring the image name to end right after
      // the app name keeps "rekordbox.exe" and drops "rekordboxAgent.exe".
      return new RegExp(`^${PROCESS_NAME}\\.exe`, 'im').test(stdout)
    }
    // -x pins pgrep to a whole-name match, which is what excludes the helpers.
    await run('pgrep', ['-x', PROCESS_NAME])
    return true
  } catch (err) {
    // Only pgrep's documented "nothing matched" (exit status 1) is a real answer of
    // "closed". Exit 2 and 3 are its syntax and fatal errors, ENOENT is a missing binary,
    // and a timeout is no answer at all — each of those means the question went
    // unanswered, which must not read as permission to write.
    if (process.platform !== 'win32' && (err as { code?: unknown })?.code === 1) return false
    return true
  }
}
