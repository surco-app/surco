import { describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))

function respond(impl: (cmd: string, args: string[]) => { stdout: string } | Error): void {
  execFile.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: unknown) => {
    const done = (typeof _opts === 'function' ? _opts : cb) as (
      err: Error | null,
      out?: { stdout: string },
    ) => void
    const result = impl(cmd, args)
    if (result instanceof Error) done(result)
    else done(null, result)
  })
}

function failure(code: number | string): Error {
  return Object.assign(new Error('failed'), { code })
}

async function runningOn(platform: string): Promise<boolean> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    vi.resetModules()
    const { isVirtualdjRunning } = await import('./virtualdjProcess')
    return await isVirtualdjRunning()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

describe('isVirtualdjRunning', () => {
  it('asks pgrep for VirtualDJ by its exact process name on macOS', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: '4242\n' }))
    expect(await runningOn('darwin')).toBe(true)
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual(['pgrep', ['-x', 'VirtualDJ']])
  })

  it('reports VirtualDJ closed only on the "nothing matched" answer of pgrep', async () => {
    execFile.mockReset()
    respond(() => failure(1))
    expect(await runningOn('darwin')).toBe(false)
  })

  it('treats a pgrep that could not answer as VirtualDJ running, so its lists are never taken as up to date by mistake', async () => {
    execFile.mockReset()
    respond(() => failure(2))
    expect(await runningOn('darwin')).toBe(true)
  })

  it('asks nothing on Windows, where Surco does not offer VirtualDJ yet', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: '' }))
    expect(await runningOn('win32')).toBe(false)
    expect(execFile).not.toHaveBeenCalled()
  })
})
