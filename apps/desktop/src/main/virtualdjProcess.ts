import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function isVirtualdjRunning(): Promise<boolean> {
  if (process.platform === 'win32') return false
  try {
    await run('pgrep', ['-x', 'VirtualDJ'])
    return true
  } catch (err) {
    return (err as { code?: unknown })?.code !== 1
  }
}
