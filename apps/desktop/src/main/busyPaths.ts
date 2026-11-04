import { foldsCase } from './outputReservations'

export interface BusyPaths {
  mark: (path: string) => void
  clear: (path: string) => void
  has: (path: string) => boolean
  idle: (path: string) => Promise<void>
}

export function busyPathKey(path: string, caseInsensitive: boolean): string {
  const nfc = path.normalize('NFC')
  return caseInsensitive ? nfc.toLowerCase() : nfc
}

export function createBusyPaths(caseInsensitive: boolean = foldsCase()): BusyPaths {
  const counts = new Map<string, number>()
  const waiters = new Map<string, (() => void)[]>()
  const key = (path: string) => busyPathKey(path, caseInsensitive)
  return {
    mark: (path) => counts.set(key(path), (counts.get(key(path)) ?? 0) + 1),
    clear: (path) => {
      const k = key(path)
      const next = (counts.get(k) ?? 0) - 1
      if (next > 0) {
        counts.set(k, next)
        return
      }
      counts.delete(k)
      for (const wake of waiters.get(k) ?? []) wake()
      waiters.delete(k)
    },
    has: (path) => counts.has(key(path)),
    idle: (path) => {
      const k = key(path)
      if (!counts.has(k)) return Promise.resolve()
      return new Promise((resolve) => waiters.set(k, [...(waiters.get(k) ?? []), resolve]))
    },
  }
}
