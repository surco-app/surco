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
    const { isSeratoRunning } = await import('./seratoProcess')
    return await isSeratoRunning()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

describe('isSeratoRunning', () => {
  it('asks pgrep for Serato DJ Pro by its exact process name on macOS', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: '4242\n' }))
    expect(await runningOn('darwin')).toBe(true)
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual(['pgrep', ['-x', 'Serato DJ Pro']])
  })

  it('reports Serato closed only on the "nothing matched" answer of pgrep', async () => {
    execFile.mockReset()
    respond(() => failure(1))
    expect(await runningOn('darwin')).toBe(false)
  })

  it('treats a pgrep that could not answer as Serato running, so its cues are never taken as up to date by mistake', async () => {
    execFile.mockReset()
    respond(() => failure(2))
    expect(await runningOn('darwin')).toBe(true)
  })

  it('lists Serato DJ Pro.exe on Windows and reports it running when it is listed', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: 'Serato DJ Pro.exe   4242 Console 1 300,000 K\r\n' }))
    expect(await runningOn('win32')).toBe(true)
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual([
      'tasklist',
      ['/FI', 'IMAGENAME eq Serato DJ Pro.exe', '/NH'],
    ])
  })

  it('reports Serato closed when the Windows listing comes back empty', async () => {
    execFile.mockReset()
    respond(() => ({
      stdout: 'INFO: No tasks are running which match the specified criteria.\r\n',
    }))
    expect(await runningOn('win32')).toBe(false)
  })
})
