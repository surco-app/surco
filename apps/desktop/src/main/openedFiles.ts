import { extname } from 'node:path'
import { AUDIO_EXTS } from './expand'

export interface OpenedFileDeps {
  window: () => { loading: boolean } | null
  ready: () => boolean
  createWindow: () => void
  send: (paths: string[]) => void
  pending: string[]
}

// Windows hands "Open with Surco" over as argv rather than open-file: process.argv on a
// cold launch, and the second instance's argv once Surco runs. The executable comes first,
// then Chromium's switches, the dev launch's app folder and the files themselves.
export function filesFromArgv(argv: string[], exists: (path: string) => boolean): string[] {
  return argv
    .slice(1)
    .filter(
      (arg) => !arg.startsWith('-') && AUDIO_EXTS.has(extname(arg).toLowerCase()) && exists(arg),
    )
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
