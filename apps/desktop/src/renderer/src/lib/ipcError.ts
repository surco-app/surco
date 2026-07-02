// Electron prefixes any error thrown by an ipcMain.handle handler with
// "Error invoking remote method '<channel>': Error: " before it reaches the renderer.
// That plumbing detail means nothing to the user and pushes the real message out of a
// row's visible width, so every surface that shows a main-process error peels it first.
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}
