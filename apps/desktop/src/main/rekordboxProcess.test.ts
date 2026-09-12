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

function noMatch(): Error {
  // pgrep's documented exit status for "no processes matched" — a real answer, not a
  // failure to ask.
  return Object.assign(new Error('no match'), { code: 1 })
}

async function load() {
  vi.resetModules()
  return await import('./rekordboxProcess')
}

describe('isRekordboxRunning', () => {
  it('reports the app as running when the process is there', async () => {
    execFile.mockReset()
    respond(() => ({ stdout: '512\n' }))
    const { isRekordboxRunning } = await load()
    await withPlatform('darwin', async () => {
      expect(await isRekordboxRunning()).toBe(true)
    })
  })

  it('reports the app as closed when nothing matches', async () => {
    execFile.mockReset()
    respond(() => noMatch())
    const { isRekordboxRunning } = await load()
    await withPlatform('darwin', async () => {
      expect(await isRekordboxRunning()).toBe(false)
    })
  })

  // The app ships helpers whose names start with the app's own: rekordboxAgent runs
  // alongside it, and on this machine it keeps running after the app itself quits. A
  // bare substring match would therefore report "open" forever and silently refuse every
  // write — the same shape of bug that made a quit aimed at a Traktor helper pop up a
  // "Where is …?" dialog. Only the exact process name counts.
  it('ignores the helper processes whose names start with the app name', async () => {
    execFile.mockReset()
    const asked: string[][] = []
    respond((_cmd, args) => {
      asked.push(args)
      return noMatch()
    })
    const { isRekordboxRunning } = await load()
    await withPlatform('darwin', async () => {
      expect(await isRekordboxRunning()).toBe(false)
    })
    // -x is what pins pgrep to a whole-name match; without it "rekordboxAgent" matches.
    expect(asked.some((args) => args.includes('-x'))).toBe(true)
  })

  // The decisive rule, and the one this project has got wrong twice on the Traktor side:
  // when the question cannot be answered — the tool is missing, the call times out,
  // pgrep reports a syntax error — the answer must be "running". Saying "closed" costs
  // the user's collection; saying "running" costs one skipped sync they are told about.
  it('assumes the app is running when the probe cannot answer', async () => {
    execFile.mockReset()
    respond(() => Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { isRekordboxRunning } = await load()
    await withPlatform('darwin', async () => {
      expect(await isRekordboxRunning()).toBe(true)
    })
  })

  it('treats a pgrep syntax error as unanswered rather than closed', async () => {
    execFile.mockReset()
    respond(() => Object.assign(new Error('bad syntax'), { code: 2 }))
    const { isRekordboxRunning } = await load()
    await withPlatform('darwin', async () => {
      expect(await isRekordboxRunning()).toBe(true)
    })
  })

  describe('on Windows', () => {
    it('reports the app as running when tasklist lists it', async () => {
      execFile.mockReset()
      respond(() => ({ stdout: 'rekordbox.exe   4242 Console   1   512 K\n' }))
      const { isRekordboxRunning } = await load()
      await withPlatform('win32', async () => {
        expect(await isRekordboxRunning()).toBe(true)
      })
    })

    // tasklist's IMAGENAME filter has no word boundary, so the helpers come back in the
    // same listing and a plain "does the output mention it" check never reports closed.
    it('ignores helper images that merely start with the app name', async () => {
      execFile.mockReset()
      respond(() => ({ stdout: 'rekordboxAgent.exe   4243 Console   1   256 K\n' }))
      const { isRekordboxRunning } = await load()
      await withPlatform('win32', async () => {
        expect(await isRekordboxRunning()).toBe(false)
      })
    })

    it('reports closed on the no-tasks notice', async () => {
      execFile.mockReset()
      respond(() => ({ stdout: 'INFO: No tasks are running which match the specified criteria.' }))
      const { isRekordboxRunning } = await load()
      await withPlatform('win32', async () => {
        expect(await isRekordboxRunning()).toBe(false)
      })
    })

    it('assumes running when tasklist itself fails', async () => {
      execFile.mockReset()
      respond(() => new Error('tasklist unavailable'))
      const { isRekordboxRunning } = await load()
      await withPlatform('win32', async () => {
        expect(await isRekordboxRunning()).toBe(true)
      })
    })
  })
})
