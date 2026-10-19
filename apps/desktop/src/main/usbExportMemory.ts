import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { UsbTarget } from '../shared/types'

// What Surco last exported to each stick, in its own file in userData rather than in
// settings.json: it is meaningful on this machine only (sticks are plugged in here) and
// grows with track IDs. Losing it only means the next export starts unticked.

export interface UsbMemoryEntry {
  playlistIds: string[]
  trackIds: string[]
  at: number
  // export.pdb right after Surco wrote it, to tell later whether someone else wrote over it.
  pdb: { size: number; mtimeMs: number } | null
  prune: boolean
  settings: boolean
}

interface MemoryFile {
  last: string | null
  entries: Record<string, UsbMemoryEntry>
}

// A folder's path must already be its real path (the IPC resolves it), so one folder reached
// through a symlink and directly is one memory.
export function targetKey(t: UsbTarget): string {
  return t.kind === 'volume' ? `volume:${t.uuid}` : `folder:${t.path}`
}

export interface UsbMemory {
  last: () => string | null
  get: (key: string) => UsbMemoryEntry | null
  remember: (key: string, entry: UsbMemoryEntry) => void
}

export function createUsbMemory(file: string): UsbMemory {
  const load = (): MemoryFile => {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as MemoryFile
      return { last: data.last ?? null, entries: data.entries ?? {} }
    } catch {
      return { last: null, entries: {} }
    }
  }
  return {
    last: () => load().last,
    get: (key) => load().entries[key] ?? null,
    remember: (key, entry) => {
      const data = load()
      data.entries[key] = entry
      data.last = key
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, file)
    },
  }
}
