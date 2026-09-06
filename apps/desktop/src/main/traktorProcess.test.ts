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

  // The dangerous direction. pgrep exiting non-zero because nothing matched is a real
  // "not running", but a command that could not run at all — tasklist missing from a
  // stripped PATH, a spawn refused, a timeout — tells us nothing, and answering "not
  // running" to that lets the write through. Traktor rewrites collection.nml wholesale
  // on quit, so a write underneath a live Traktor is silently discarded: the cues and
  // grid the user just synced are gone with no error anywhere. Refusing to answer costs
  // one skipped sync the user is told about; guessing costs their work.
  it('reports Traktor running when Windows cannot answer', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond(() => new Error('spawn tasklist ENOENT'))

    const running = await withPlatform('win32', async () => {
      const { isTraktorRunning } = await import('./traktorProcess')
      return isTraktorRunning()
    })

    expect(running).toBe(true)
  })

  // Same on Unix, but only for a genuine failure to run the tool: see the next test for
  // the exit code that legitimately means "no match".
  it('reports Traktor running when pgrep cannot be run at all', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond(() => Object.assign(new Error('spawn pgrep ENOENT'), { code: 'ENOENT' }))

    const running = await withPlatform('darwin', async () => {
      const { isTraktorRunning } = await import('./traktorProcess')
      return isTraktorRunning()
    })

    expect(running).toBe(true)
  })

  // pgrep's documented "no processes matched" exit. This one really does mean Traktor
  // is closed, and must keep letting the sync through — a guard that blocked here would
  // refuse every sync on every machine.
  it('reports Traktor gone when pgrep exits 1 with no match', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond(() => Object.assign(new Error('Command failed: pgrep'), { code: 1 }))

    const running = await withPlatform('darwin', async () => {
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

  // Follows from isTraktorRunning refusing to guess: if the check cannot run, the poll
  // never sees Traktor disappear and the quit is reported as failed. That is the honest
  // answer — we did not confirm it closed — and the caller then declines to write the
  // collection, which is the safe side. The cost is the user waiting out the poll.
  it('reports the quit unconfirmed when the running check cannot answer', async () => {
    vi.resetModules()
    execFile.mockReset()
    respond((cmd) =>
      cmd === 'taskkill'
        ? { stdout: 'SUCCESS' }
        : Object.assign(new Error('spawn tasklist ENOENT'), { code: 'ENOENT' }),
    )

    // The poll waits 500 ms between 30 attempts; fake timers run those out instantly
    // rather than making the suite sit through the real 15 s.
    vi.useFakeTimers()
    try {
      const gone = await withPlatform('win32', async () => {
        const { quitTraktor } = await import('./traktorProcess')
        const pending = quitTraktor()
        await vi.runAllTimersAsync()
        return pending
      })

      expect(gone).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
