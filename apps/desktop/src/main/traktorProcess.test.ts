import { describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))

// promisify(execFile) resolves whatever the callback's second argument holds, so the
// mock speaks the callback protocol the real execFile does rather than returning a
// promise — otherwise promisify would wrap a promise in a promise and never see stdout.
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

async function withPlatform<T>(platform: string, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return await run()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

describe('isTraktorRunning', () => {
  // The guard's whole job is to stop a collection.nml write while Traktor holds the
  // library in memory. Traktor always wins that race — it rewrites the file on quit —
  // so a filter that silently matches nothing reports "not running" and lets the write
  // through, which is the exact loss the guard exists to prevent. Microsoft documents a
  // wildcard as a valid IMAGENAME filter *value* (`/fi "IMAGENAME eq note*"`), and the
  // binary has been named "Traktor", "Traktor Pro" and "Traktor Pro 4" across releases.
  it('asks Windows for every image name starting with Traktor', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond(() => ({ stdout: 'Traktor Pro 4.exe    1234 Console    1    120,000 K\r\n' }))

    const running = await withPlatform('win32', async () => {
      const { isTraktorRunning } = await import('./traktorProcess')
      return isTraktorRunning()
    })

    expect(running).toBe(true)
    const [cmd, args] = execFile.mock.calls[0]
    expect(cmd).toBe('tasklist')
    expect(args).toContain('/FI')
    expect(args.join(' ')).toContain('IMAGENAME eq Traktor*')
  })

  it('reports Traktor gone when the listing comes back empty', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond(() => ({
      stdout: 'INFO: No tasks are running which match the specified criteria.\r\n',
    }))

    const running = await withPlatform('win32', async () => {
      const { isTraktorRunning } = await import('./traktorProcess')
      return isTraktorRunning()
    })

    expect(running).toBe(false)
  })
})

describe('quitTraktor', () => {
  // taskkill documents the wildcard as accepted for /IM "only when a filter is applied",
  // so `/IM Traktor*.exe` on its own errors out. The catch here swallows that, the poll
  // then runs its full 15 s, and the user is told Traktor could not be closed while
  // nothing ever asked it to close. The documented shape puts the pattern in the filter
  // and a bare `*` in /IM. No /F: the point is a graceful close so Traktor saves.
  it('applies a filter alongside the wildcard so taskkill accepts it', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond((cmd) =>
      cmd === 'taskkill'
        ? { stdout: 'SUCCESS' }
        : { stdout: 'INFO: No tasks are running which match the specified criteria.\r\n' },
    )

    const gone = await withPlatform('win32', async () => {
      const { quitTraktor } = await import('./traktorProcess')
      return quitTraktor()
    })

    expect(gone).toBe(true)
    const [cmd, args] = execFile.mock.calls[0]
    expect(cmd).toBe('taskkill')
    expect(args).toContain('/FI')
    expect(args.join(' ')).toContain('IMAGENAME eq Traktor*')
    expect(args).not.toContain('/F')
  })
})
