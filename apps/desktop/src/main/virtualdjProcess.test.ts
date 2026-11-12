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

  it('lists every virtualdj* image on Windows and reports it running when one is listed, whatever its case', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: 'VirtualDJ.exe   4242 Console 1 300,000 K\r\n' }))
    expect(await runningOn('win32')).toBe(true)
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual([
      'tasklist',
      ['/FI', 'IMAGENAME eq virtualdj*', '/NH'],
    ])
  })

  it('reads a VirtualDJ build with another image name, such as virtualdj8.exe, as running, so Surco never writes under it', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: '\r\nvirtualdj8.exe   4242 Console 1 300,000 K\r\n' }))
    expect(await runningOn('win32')).toBe(true)
  })

  it('reads only the image name column, so a line that merely mentions VirtualDJ does not count', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: 'helper.exe   4242 Console 1 virtualdj.exe\r\n' }))
    expect(await runningOn('win32')).toBe(false)
  })

  it('reports VirtualDJ closed when the Windows listing comes back empty', async () => {
    execFile.mockReset()
    respond(() => ({
      stdout: 'INFO: No tasks are running which match the specified criteria.\r\n',
    }))
    expect(await runningOn('win32')).toBe(false)
  })

  it('treats a tasklist that could not answer as VirtualDJ running, so nothing is written under it', async () => {
    execFile.mockReset()
    respond(() => failure(1))
    expect(await runningOn('win32')).toBe(true)
  })
})

describe('waitForVirtualdjExit', () => {
  it('waits while VirtualDJ is still exiting after the DJ closed it, never ending it itself', async () => {
    vi.resetModules()
    const { waitForVirtualdjExit } = await import('./virtualdjProcess')
    const isRunning = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    const wait = vi.fn(async () => {})
    expect(await waitForVirtualdjExit(isRunning, wait)).toBe(true)
    expect(isRunning).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('gives up after about fifteen seconds when VirtualDJ stays open', async () => {
    vi.resetModules()
    const { waitForVirtualdjExit } = await import('./virtualdjProcess')
    const wait = vi.fn(async (_ms: number) => {})
    expect(await waitForVirtualdjExit(async () => true, wait)).toBe(false)
    expect(wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBe(15000)
  })
})
