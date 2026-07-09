type LogError = (message: string, stack?: string) => void

// The slice of window the listeners need, so tests hand in a fake.
interface ErrorEvents {
  addEventListener(type: 'error', cb: (e: ErrorEvent) => void): void
  addEventListener(type: 'unhandledrejection', cb: (e: PromiseRejectionEvent) => void): void
}

// React boundaries only see render errors: a throw in a DOM event handler or a
// rejection nothing awaited never reaches them, and console.error dies with the
// window. Forwarding both global events to main's log file is what makes a user
// report debuggable — there is no telemetry by design.
export function installGlobalErrorLogging(target: ErrorEvents, logError: LogError): void {
  target.addEventListener('error', (e) => {
    logError(e.message, e.error instanceof Error ? e.error.stack : undefined)
  })
  target.addEventListener('unhandledrejection', (e) => {
    const reason: unknown = e.reason
    if (reason instanceof Error) logError(reason.message, reason.stack)
    else logError(String(reason))
  })
}
