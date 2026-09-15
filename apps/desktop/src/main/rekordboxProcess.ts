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
// Asks rekordbox to quit and waits until it is really gone, reporting whether it went.
//
// Always a polite quit, never a forced kill: rekordbox holds master.db open through
// SQLCipher, and killing it mid-write can leave the collection — the one file the user
// cannot rebuild — in a broken state. Asking the app to quit lets it close the database
// itself, which is the whole reason this exists rather than a signal.
//
// Unconfirmed reads as "still running", the same asymmetry isRekordboxRunning uses: the
// caller then declines to write, costing one skipped repoint the user is told about,
// rather than writing underneath a live collection.
export async function quitRekordbox(
  options: { attempts?: number; waitMs?: number } = {},
): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // No /F, so rekordbox saves and releases master.db on its way out.
      await run('taskkill', ['/IM', `${PROCESS_NAME}.exe`])
    } else {
      await run('osascript', ['-e', `tell application "${PROCESS_NAME}" to quit`])
    }
  } catch {
    // The quit request failing outright (already gone, tool missing) resolves by
    // whatever the poll below observes.
  }
  const attempts = options.attempts ?? 30
  const waitMs = options.waitMs ?? 500
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!(await isRekordboxRunning())) return true
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  return false
}

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
