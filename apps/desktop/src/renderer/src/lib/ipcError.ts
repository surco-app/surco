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
