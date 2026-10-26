import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Whether the Engine DJ app is running. Engine loads its database once at launch and
// never re-reads the file, and its SQLite connection runs in rollback-journal mode —
// so no on-disk artifact reliably says "in use" while it idles. The process itself is
// the signal: writing m.db under a live Engine loses whichever side saves last.
// The binary is named "Engine DJ" on both platforms (pgrep -x matches it exactly).
export async function isEngineDjRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq Engine DJ.exe', '/NH'])
      return stdout.includes('Engine DJ')
    }
    await run('pgrep', ['-x', 'Engine DJ'])
    return true
  } catch (err) {
    // Only pgrep's documented "nothing matched" (exit status 1) is a real answer of
    // "closed". Any other failure means the question went unanswered, which must not read
    // as permission to write: a skipped write is reported, a lost library is not.
    if (process.platform !== 'win32' && (err as { code?: unknown })?.code === 1) return false
    return true
  }
}

// Asks Engine DJ to quit the polite way — the AppleScript quit event (a windowed
// taskkill on Windows) is the same as the user pressing ⌘Q, so Engine saves and closes
// its database cleanly. Then waits for the process to actually disappear: writing the
// library while Engine is mid-shutdown would be the exact race the guard exists for.
// Returns whether Engine is gone; a quit refused (unsaved dialog, hang) reports false.
export async function quitEngineDj(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await run('taskkill', ['/IM', 'Engine DJ.exe'])
    } else {
      await run('osascript', ['-e', 'tell application "Engine DJ" to quit'])
    }
  } catch {
    // The quit event failing outright (app already gone, tool missing) resolves by
    // whatever the poll below observes.
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await isEngineDjRunning())) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}
