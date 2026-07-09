import { describe, expect, it, vi } from 'vitest'
import { installGlobalErrorLogging } from './logGlobalErrors'

function fakeWindow(): {
  addEventListener: (type: string, cb: (e: never) => void) => void
  fire: (type: string, event: unknown) => void
} {
  const handlers = new Map<string, (e: never) => void>()
  return {
    addEventListener: (type, cb) => handlers.set(type, cb),
    fire: (type, event) => (handlers.get(type) as ((e: unknown) => void) | undefined)?.(event),
  }
}

describe('installGlobalErrorLogging', () => {
  // React boundaries only see render errors: a throw in a DOM event handler or a
  // rejection nothing awaited never reaches them, and console.error dies with the
  // window. These listeners are what gets those crashes into main's log file.
  it('logs uncaught window errors with their stack', () => {
    const win = fakeWindow()
    const logError = vi.fn()
    installGlobalErrorLogging(win, logError)
    const error = new Error('boom')
    win.fire('error', { message: 'boom', error })
    expect(logError).toHaveBeenCalledWith('boom', error.stack)
  })

  it('logs unhandled rejections, stringifying non-Error reasons', () => {
    const win = fakeWindow()
    const logError = vi.fn()
    installGlobalErrorLogging(win, logError)
    const error = new Error('rejected')
    win.fire('unhandledrejection', { reason: error })
    expect(logError).toHaveBeenCalledWith('rejected', error.stack)
    win.fire('unhandledrejection', { reason: 'plain string' })
    expect(logError).toHaveBeenCalledWith('plain string')
  })
})
