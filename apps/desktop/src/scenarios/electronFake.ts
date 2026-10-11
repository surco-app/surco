import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

type Handler = (event: unknown, ...args: never[]) => unknown

export const ipcHandlers = new Map<string, Handler>()

const HOUR_MS = 60 * 60 * 1000
const scenarios = join(tmpdir(), 'surco-scenarios')
mkdirSync(scenarios, { recursive: true })
for (const name of readdirSync(scenarios)) {
  const stale = join(scenarios, name)
  const age = Date.now() - (statSync(stale, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
  if (age > HOUR_MS) rmSync(stale, { recursive: true, force: true })
}

export const scenarioRoot = mkdtempSync(join(scenarios, 'run-'))
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
