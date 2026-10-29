import { type ErrorKey, errorKeyOf } from '../shared/errorKeys'
// The narrow slices of process / webContents the guards need, so tests hand in fakes.
export interface CrashLogger {
  error: (...params: unknown[]) => void
}

interface ProcessEvents {
  on(event: 'uncaughtException', cb: (err: Error) => void): unknown
  on(event: 'unhandledRejection', cb: (reason: unknown) => void): unknown
}

// Registering these handlers replaces Electron's default fatal dialog: a throw
// inside any ipcMain listener (or a rejection nothing awaited) logs to the file a
// user can attach to a report and the app keeps running, instead of dying with an
// unloggable dialog and losing up to a second of debounced session edits. There
// is no telemetry by design, so the log line is the only forensic artifact.
export function installCrashGuards(proc: ProcessEvents, logger: CrashLogger): void {
  proc.on('uncaughtException', (err) => logger.error('uncaughtException', err))
  proc.on('unhandledRejection', (reason) => logger.error('unhandledRejection', reason))
}

interface HandlerRegistry<E, A extends unknown[]> {
  handle(channel: string, cb: (event: E, ...args: A) => unknown): void
}

// A throw inside an ipcMain.handle never reaches uncaughtException: Electron turns it into
// a rejection for the renderer and prints it to the console, and screens that catch it
// show a generic error. Wrapping every handler once puts each failure, with its channel,
// in the log file a user can send.
const QUIET_KEYS: ReadonlySet<ErrorKey> = new Set(['beatportTerritoryRestricted'])

function expected(err: unknown): boolean {
  const e = err as Error | undefined
  if (e?.name === 'AbortError') return true
  const key = typeof e?.message === 'string' ? errorKeyOf(e.message) : null
  return key !== null && QUIET_KEYS.has(key)
}

export function logHandlerFailures<E, A extends unknown[]>(
  ipc: HandlerRegistry<E, A>,
  logger: CrashLogger,
): void {
  const handle = ipc.handle.bind(ipc)
  ipc.handle = (channel, cb) =>
    handle(channel, async (event: E, ...args: A) => {
      try {
        return await cb(event, ...args)
      } catch (err) {
        if (!expected(err)) logger.error(`ipc ${channel} failed`, err)
        throw err
      }
    })
}

// Normal teardowns the recovery must not fight: closing the window ('clean-exit')
// or the OS/user killing the process on purpose ('killed').
const EXPECTED_EXITS = new Set(['clean-exit', 'killed'])

interface GoneDetails {
  reason: string
}

interface RendererContents {
  on(event: 'render-process-gone', cb: (event: unknown, details: GoneDetails) => void): unknown
  reload(): void
}

// A dead renderer (an OOM during a big spectrogram batch is the plausible case)
// otherwise leaves a permanently blank window: the React ErrorBoundary lives in
// the process that just died, so recovery has to come from main. Reloading gets
// the user back to a working app, and the session file restores their crate.
export function wireRendererRecovery(contents: RendererContents, logger: CrashLogger): void {
  contents.on('render-process-gone', (_event, details) => {
    if (EXPECTED_EXITS.has(details.reason)) return
    logger.error('render process gone', details)
    contents.reload()
  })
}
