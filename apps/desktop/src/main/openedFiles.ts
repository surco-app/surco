export interface OpenedFileDeps {
  window: () => { loading: boolean } | null
  ready: () => boolean
  createWindow: () => void
  send: (paths: string[]) => void
  pending: string[]
}

export function routeOpenedFile(path: string, deps: OpenedFileDeps): void {
  const win = deps.window()
  if (win && !win.loading) {
    deps.send([path])
    return
  }
  deps.pending.push(path)
  if (!win && deps.ready()) deps.createWindow()
}
