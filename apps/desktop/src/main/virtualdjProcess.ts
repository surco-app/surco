import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function waitForVirtualdjExit(
  isRunning: () => Promise<boolean> = isVirtualdjRunning,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await isRunning())) return true
    await wait(500)
  }
  return false
}
