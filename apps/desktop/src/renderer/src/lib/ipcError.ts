import { errorKeyOf } from '../../../shared/errorKeys'

// Re-exported so every renderer surface reaches for one module when it has a
// main-process error in hand, rather than importing the key helper from shared and the
// prefix peeling from here.
export { type ErrorKey, errorKeyOf } from '../../../shared/errorKeys'

// Electron prefixes any error thrown by an ipcMain.handle handler with
// "Error invoking remote method '<channel>': Error: " before it reaches the renderer.
// That plumbing detail means nothing to the user and pushes the real message out of a
// row's visible width, so every surface that shows a main-process error peels it first.
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

// Whether a failure is Windows refusing to replace a file another program holds open
// (see main/renameRetry.ts, which stamps the marker after its retries run out). The
// IPC hop drops the error's `code` and every custom property, so this marker in the
// message text is all that reaches the renderer — matched here so the row can name
// the real cause instead of showing "EPERM: operation not permitted" to a DJ.
export function isFileInUseMessage(message: string): boolean {
  return message.includes('SURCO_FILE_IN_USE')
}

// One way to turn a rejected IPC call into something worth showing: peel the plumbing,
// translate a key the main process stamped, and otherwise keep the raw text — ffmpeg's
// own stderr says more in a bug report than a generic sentence would. `fallback` covers
// a rejection with nothing readable in it at all.
export function mainErrorMessage(
  e: unknown,
  translate: (key: string) => string,
  fallback: string,
): string {
  const raw = e instanceof Error ? cleanIpcError(e.message) : ''
  if (!raw) return fallback
  const key = errorKeyOf(raw)
  return key ? translate(`errors.${key}`) : raw
}
