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
  } catch {
    // pgrep exits non-zero when nothing matches; a missing tool also means "can't
    // tell", where blocking every conversion would be worse than proceeding.
    return false
  }
}
