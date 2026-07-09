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
