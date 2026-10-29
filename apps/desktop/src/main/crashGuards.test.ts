import { describe, expect, it, vi } from 'vitest'
import { installCrashGuards, logHandlerFailures, wireRendererRecovery } from './crashGuards'

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
    const logger = { error: vi.fn() }
    wireRendererRecovery(contents, logger)
    const details = { reason: 'oom', exitCode: 1 }
    contents.fire('render-process-gone', {}, details)
    expect(logger.error).toHaveBeenCalledWith('render process gone', details)
    expect(contents.reload).toHaveBeenCalled()
  })

  it.each(['clean-exit', 'killed'])('leaves a normal %s teardown alone', (reason) => {
    const contents = { ...fakeEmitter(), reload: vi.fn() }
    const logger = { error: vi.fn() }
    wireRendererRecovery(contents, logger)
    contents.fire('render-process-gone', {}, { reason })
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
    ipc.handle('rekordbox:saveCues', () => {
      throw boom
    })
    await expect(ipc.call('rekordbox:saveCues')).rejects.toBe(boom)
    expect(logger.error).toHaveBeenCalledWith('ipc rekordbox:saveCues failed', boom)
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
