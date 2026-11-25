import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { waitForExit } from './programExit'

const run = promisify(execFile)

export async function isVirtualdjRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq virtualdj*', '/NH'])
      return /^virtualdj[^\s]*\.exe(\s|$)/im.test(stdout)
    }
    await run('pgrep', ['-x', 'VirtualDJ'])
    return true
  } catch (err) {
    return process.platform === 'win32' || (err as { code?: unknown })?.code !== 1
  }
}

export async function waitForVirtualdjExit(
  isRunning: () => Promise<boolean> = isVirtualdjRunning,
  wait?: (ms: number) => Promise<void>,
): Promise<boolean> {
  return waitForExit(isRunning, { wait })
}
