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
    const { isEngineDjRunning } = await import('./engineProcess')
    return await isEngineDjRunning()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

describe('isEngineDjRunning', () => {
  it('reports Engine DJ running when pgrep finds it', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: '4242\n' }))
    expect(await runningOn('darwin')).toBe(true)
  })

  it('reports Engine DJ closed only on the "nothing matched" answer of pgrep', async () => {
    execFile.mockReset()
    respond(() => failure(1))
    expect(await runningOn('darwin')).toBe(false)
  })

  it('treats a pgrep that could not answer as Engine DJ running, since writing m.db under it loses the library', async () => {
    execFile.mockReset()
    respond(() => failure(2))
    expect(await runningOn('darwin')).toBe(true)
    execFile.mockReset()
    respond(() => failure('ENOENT'))
    expect(await runningOn('darwin')).toBe(true)
  })

  it('reports Engine DJ closed when the Windows listing comes back empty', async () => {
    execFile.mockReset()
    respond(() => ({
      stdout: 'INFO: No tasks are running which match the specified criteria.\r\n',
    }))
    expect(await runningOn('win32')).toBe(false)
  })

  it('treats a Windows listing that failed as Engine DJ running', async () => {
    execFile.mockReset()
    respond(() => failure(1))
    expect(await runningOn('win32')).toBe(true)
  })
})
