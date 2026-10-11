import { mkdirSync, mkdtempSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

type Handler = (event: unknown, ...args: never[]) => unknown

export const ipcHandlers = new Map<string, Handler>()

export const scenarioRoot = mkdtempSync(join(tmpdir(), 'surco-scenario-'))
const home = join(scenarioRoot, 'home')

export const osTrash: string[] = []

export function electronFake() {
  return {
    app: {
      isPackaged: false,
      on: () => {},
      getPath: (name: string) => {
        const dir = join(home, name)
        mkdirSync(dir, { recursive: true })
        return dir
      },
    },
    shell: {
      trashItem: async (path: string) => {
        const bin = join(home, 'Trash')
        mkdirSync(bin, { recursive: true })
        renameSync(path, join(bin, `${osTrash.length}-${basename(path)}`))
        osTrash.push(path)
      },
    },
    ipcMain: {
      handle: (channel: string, handler: Handler) => ipcHandlers.set(channel, handler),
    },
  }
}
