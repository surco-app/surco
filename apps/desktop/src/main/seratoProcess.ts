import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { waitForExit } from './programExit'

const run = promisify(execFile)

export async function isSeratoRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq Serato DJ Pro.exe', '/NH'])
      return stdout.includes('Serato DJ Pro')
    }
    await run('pgrep', ['-x', 'Serato DJ Pro'])
    return true
  } catch (err) {
    if (process.platform !== 'win32' && (err as { code?: unknown })?.code === 1) return false
    return true
  }
}

export async function waitForSeratoExit(
  isRunning: () => Promise<boolean> = isSeratoRunning,
  wait?: (ms: number) => Promise<void>,
): Promise<boolean> {
  return waitForExit(isRunning, { wait })
}
