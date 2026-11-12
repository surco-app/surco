import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function waitForSeratoExit(
  isRunning: () => Promise<boolean> = isSeratoRunning,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await isRunning())) return true
    await wait(500)
  }
  return false
}
