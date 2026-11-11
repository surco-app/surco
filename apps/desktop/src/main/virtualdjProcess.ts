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
