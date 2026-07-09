import { describe, expect, it, vi } from 'vitest'
import { installCrashGuards, wireRendererRecovery } from './crashGuards'

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
