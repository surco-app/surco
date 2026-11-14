import { describe, expect, it, vi } from 'vitest'
import { errorWithKey } from '../shared/errorKeys'
import {
  installCrashGuards,
  logHandlerFailures,
  wireChildProcessGone,
  wireQuitTrail,
  wireRendererRecovery,
  wireUnresponsive,
} from './crashGuards'

function fakeEmitter(): {
  on: (event: string, cb: (...args: never[]) => void) => void
  fire: (event: string, ...args: unknown[]) => void
} {
  const handlers = new Map<string, (...args: never[]) => void>()
  return {
    on: (event, cb) => handlers.set(event, cb),
    fire: (event, ...args) =>
      (handlers.get(event) as ((...args: unknown[]) => void) | undefined)?.(...args),
  }
}

describe('installCrashGuards', () => {
  // Without these guards a throw inside any ipcMain.on listener kills the whole app
  // through Electron's default fatal dialog, leaving no trace in the log file a user
  // could attach to a report — the log line is the only forensic artifact we get.
  it('logs uncaught exceptions instead of leaving them fatal', () => {
    const proc = fakeEmitter()
    const logger = { error: vi.fn() }
    installCrashGuards(proc, logger)
    const boom = new Error('boom')
    proc.fire('uncaughtException', boom)
    expect(logger.error).toHaveBeenCalledWith('uncaughtException', boom)
  })

  it('logs unhandled rejections, which otherwise only warn on a console nobody sees', () => {
    const proc = fakeEmitter()
    const logger = { error: vi.fn() }
    installCrashGuards(proc, logger)
    proc.fire('unhandledRejection', 'offline')
    expect(logger.error).toHaveBeenCalledWith('unhandledRejection', 'offline')
  })
})

describe('wireRendererRecovery', () => {
  // A dead renderer (OOM on a big spectrogram batch) leaves a permanently blank
  // window: the React ErrorBoundary lives inside the very process that died, so
  // recovery has to come from main.
  it('logs and reloads when the renderer dies unexpectedly', () => {
    const contents = { ...fakeEmitter(), reload: vi.fn() }
    const logger = { error: vi.fn(), warn: vi.fn() }
    wireRendererRecovery(contents, logger)
    const details = { reason: 'oom', exitCode: 1 }
    contents.fire('render-process-gone', {}, details)
    expect(logger.error).toHaveBeenCalledWith('render process gone', details)
    expect(contents.reload).toHaveBeenCalled()
  })

  it('leaves a clean-exit teardown alone', () => {
    const contents = { ...fakeEmitter(), reload: vi.fn() }
    const logger = { error: vi.fn(), warn: vi.fn() }
    wireRendererRecovery(contents, logger)
    contents.fire('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(contents.reload).not.toHaveBeenCalled()
  })

  it('notes a killed window without reloading it, since the system killing it is a lead when the app vanishes', () => {
    const contents = { ...fakeEmitter(), reload: vi.fn() }
    const logger = { error: vi.fn(), warn: vi.fn() }
    wireRendererRecovery(contents, logger)
    const details = { reason: 'killed', exitCode: 9 }
    contents.fire('render-process-gone', {}, details)
    expect(logger.warn).toHaveBeenCalledWith('render process killed', details)
    expect(logger.error).not.toHaveBeenCalled()
    expect(contents.reload).not.toHaveBeenCalled()
  })
})

describe('logHandlerFailures', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  function fakeIpc() {
    const handlers = new Map<string, Handler>()
    return {
      handle: (channel: string, cb: Handler) => {
        handlers.set(channel, cb)
      },
      call: (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args),
    }
  }

  // A handler that throws only rejects the renderer's promise: Electron prints it to a
  // console nobody sees and the screen that catches it shows a generic error, so a user's
  // log came back empty for a cue save that failed (Traktor, 27/10).
  it('logs a failing handler with its channel and still rejects the caller', async () => {
    const ipc = fakeIpc()
    const logger = { error: vi.fn() }
    logHandlerFailures(ipc, logger)
    const boom = new Error('boom')
    ipc.handle('cues:save', () => {
      throw boom
    })
    await expect(ipc.call('cues:save')).rejects.toBe(boom)
    expect(logger.error).toHaveBeenCalledWith('ipc cues:save failed', boom)
  })

  // A read the user walked away from is cancelled on purpose: logging it put a stack trace
  // of "analysis aborted" in the log for every playlist clicked past, burying real failures.
  it('leaves a cancelled call out of the log and still rejects the caller', async () => {
    const ipc = fakeIpc()
    const logger = { error: vi.fn() }
    logHandlerFailures(ipc, logger)
    const cancelled = Object.assign(new Error('analysis aborted'), { name: 'AbortError' })
    ipc.handle('applemusic:playlistTracks', async () => Promise.reject(cancelled))
    await expect(ipc.call('applemusic:playlistTracks')).rejects.toBe(cancelled)
    expect(logger.error).not.toHaveBeenCalled()
  })

  // Beatport refusing a release in this country is its answer, not Surco failing: the
  // search goes on with the other sources, yet every auto-match left a stack trace in the
  // log, burying the real failures a user sends in (log of 29/10).
  it('leaves Beatport refusing a release in this country out of the log and still rejects the caller', async () => {
    const ipc = fakeIpc()
    const logger = { error: vi.fn() }
    logHandlerFailures(ipc, logger)
    const refused = errorWithKey('beatportTerritoryRestricted', '/catalog/releases/6856771/')
    ipc.handle('search:release', async () => Promise.reject(refused))
    await expect(ipc.call('search:release')).rejects.toBe(refused)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('still logs every other known failure', async () => {
    const ipc = fakeIpc()
    const logger = { error: vi.fn() }
    logHandlerFailures(ipc, logger)
    const missing = errorWithKey('fileMissing', '/m/a.wav')
    ipc.handle('audio:meta', async () => Promise.reject(missing))
    await expect(ipc.call('audio:meta')).rejects.toBe(missing)
    expect(logger.error).toHaveBeenCalledWith('ipc audio:meta failed', missing)
  })

  it('logs an async handler that rejects', async () => {
    const ipc = fakeIpc()
    const logger = { error: vi.fn() }
    logHandlerFailures(ipc, logger)
    ipc.handle('traktor:canSave', async () => Promise.reject('offline'))
    await expect(ipc.call('traktor:canSave')).rejects.toBe('offline')
    expect(logger.error).toHaveBeenCalledWith('ipc traktor:canSave failed', 'offline')
  })

  it('passes arguments and results through untouched', async () => {
    const ipc = fakeIpc()
    const logger = { error: vi.fn() }
    logHandlerFailures(ipc, logger)
    ipc.handle('sum', (_e, a, b) => (a as number) + (b as number))
    expect(await ipc.call('sum', 2, 3)).toBe(5)
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('wireRendererRecovery onGone', () => {
  it('hands the crash to onGone before reloading, so the dump and the notice see the dead window state', () => {
    const calls: string[] = []
    const contents = { ...fakeEmitter(), reload: vi.fn(() => calls.push('reload')) }
    const onGone = vi.fn(() => calls.push('onGone'))
    wireRendererRecovery(contents, { error: vi.fn(), warn: vi.fn() }, onGone)
    contents.fire('render-process-gone', {}, { reason: 'crashed', exitCode: 5 })
    expect(calls).toEqual(['onGone', 'reload'])
    expect(onGone).toHaveBeenCalledWith({
      reason: 'crashed',
      exitCode: 5,
      at: expect.any(Number),
    })
  })
})

describe('wireChildProcessGone', () => {
  it('logs a GPU or utility process that dies, which used to vanish without a line', () => {
    const app = fakeEmitter()
    const logger = { error: vi.fn(), warn: vi.fn() }
    const onGone = vi.fn()
    wireChildProcessGone(app, logger, onGone)
    const details = { type: 'GPU', reason: 'crashed', exitCode: 11, name: 'gpu' }
    app.fire('child-process-gone', {}, details)
    expect(logger.error).toHaveBeenCalledWith('child process gone', details)
    expect(onGone).toHaveBeenCalledWith('GPU')
  })

  it('ignores a child process that exits cleanly', () => {
    const app = fakeEmitter()
    const logger = { error: vi.fn(), warn: vi.fn() }
    const onGone = vi.fn()
    wireChildProcessGone(app, logger, onGone)
    app.fire('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(onGone).not.toHaveBeenCalled()
  })

  it('notes a killed child process with the memory before it, since memory pressure kills that way', () => {
    const app = fakeEmitter()
    const logger = { error: vi.fn(), warn: vi.fn() }
    const onGone = vi.fn()
    wireChildProcessGone(app, logger, onGone)
    const details = { type: 'GPU', reason: 'killed', exitCode: 9 }
    app.fire('child-process-gone', {}, details)
    expect(logger.warn).toHaveBeenCalledWith('child process killed', details)
    expect(logger.error).not.toHaveBeenCalled()
    expect(onGone).toHaveBeenCalledWith('GPU')
  })
})

describe('wireUnresponsive', () => {
  function hung(responsiveAt: number) {
    const contents = fakeEmitter()
    const logger = { error: vi.fn(), warn: vi.fn() }
    let clock = 0
    wireUnresponsive(contents, logger, () => clock, 10_000)
    contents.fire('unresponsive')
    clock = responsiveAt
    contents.fire('responsive')
    return logger
  }

  it('logs how long the window hung, as an error past ten seconds', () => {
    const logger = hung(12_000)
    expect(logger.error).toHaveBeenCalledWith('window responsive again after', 12_000, 'ms')
  })

  it('logs a short hang as a warning, since the window recovered on its own', () => {
    const logger = hung(3_000)
    expect(logger.warn).toHaveBeenCalledWith('window responsive again after', 3_000, 'ms')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs the moment the window stops answering', () => {
    const contents = fakeEmitter()
    const logger = { error: vi.fn(), warn: vi.fn() }
    wireUnresponsive(contents, logger, () => 0, 10_000)
    contents.fire('unresponsive')
    expect(logger.warn).toHaveBeenCalledWith('window unresponsive')
  })
})

describe('wireQuitTrail', () => {
  it('logs the start and every step of a quit, so a log that ends without them means the app died instead', () => {
    const appEvents = fakeEmitter()
    const logger = { info: vi.fn() }
    const started = { version: '1.34.4', platform: 'darwin', arch: 'x64', os: '26.2' }
    wireQuitTrail(appEvents, logger, started)
    appEvents.fire('before-quit')
    appEvents.fire('will-quit')
    appEvents.fire('quit', {}, 0)
    expect(logger.info.mock.calls).toEqual([
      ['app started', started],
      ['app quit requested'],
      ['app will quit'],
      ['app quit', { exitCode: 0 }],
    ])
  })
})
