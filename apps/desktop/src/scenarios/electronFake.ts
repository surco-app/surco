import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    ipcMain: {
      handle: (channel: string, handler: Handler) => ipcHandlers.set(channel, handler),
    },
  }
}
