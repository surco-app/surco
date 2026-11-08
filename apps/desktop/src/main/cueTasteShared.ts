import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { TasteTrack } from '../shared/dropTaste'
import type { SharedEdits } from './cueTaste'

const FOLDER = 'cue-taste'

export function createSharedEdits(settingsDir: () => string | null): SharedEdits {
  return {
    write(machine, edits) {
      const dir = settingsDir()
      if (!dir) return
      const folder = join(dir, FOLDER)
      mkdirSync(folder, { recursive: true })
      const file = join(folder, `${machine}.json`)
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, edits }), 'utf8')
      renameSync(`${file}.tmp`, file)
    },
    readOthers(machine) {
      const dir = settingsDir()
      if (!dir) return []
      const folder = join(dir, FOLDER)
      let names: string[]
      try {
        names = readdirSync(folder)
      } catch {
        return []
      }
      return names
        .filter((name) => name.endsWith('.json') && name !== `${machine}.json`)
        .flatMap((name) => {
          try {
            const saved = JSON.parse(readFileSync(join(folder, name), 'utf8')) as {
              edits?: TasteTrack[]
            }
            return saved.edits ?? []
          } catch (err) {
            log.warn(`cue taste: skipping unreadable ${name} from another Mac: ${String(err)}`)
            return []
          }
        })
    },
  }
}
