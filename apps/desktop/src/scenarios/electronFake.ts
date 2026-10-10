import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Handler = (event: unknown, ...args: never[]) => unknown

export const ipcHandlers = new Map<string, Handler>()

const home = mkdtempSync(join(tmpdir(), 'surco-scenario-home-'))

export function electronFake() {
  return {
    app: {
      isPackaged: false,
      getPath: (name: string) => {
        const dir = join(home, name)
        mkdirSync(dir, { recursive: true })
        return dir
      },
    },
    ipcMain: {
      handle: (channel: string, handler: Handler) => ipcHandlers.set(channel, handler),
    },
  }
}
