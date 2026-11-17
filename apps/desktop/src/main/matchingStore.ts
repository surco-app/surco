import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface MatchingStore {
  list(): [string, string][]
  add(a: string, b: string): void
  remove(a: string, b: string): void
  removeAll(pairs: [string, string][]): void
  movePath(from: string, to: string): void
}

interface StoreFile {
  version: 1
  pairs: [string, string][]
}

const key = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

function deduped(pairs: readonly [string, string][]): [string, string][] {
  const seen = new Set<string>()
  const out: [string, string][] = []
  for (const [a, b] of pairs) {
    if (a === b || seen.has(key(a, b))) continue
    seen.add(key(a, b))
    out.push([a, b])
  }
  return out
}

export function createMatchingStore(file: string): MatchingStore {
  const load = (): [string, string][] => {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoreFile>
      return Array.isArray(data.pairs)
        ? data.pairs.filter(
            (p): p is [string, string] =>
              Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string',
          )
        : []
    } catch {
      return []
    }
  }
  const save = (pairs: [string, string][]): void => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, pairs: deduped(pairs) } satisfies StoreFile))
    renameSync(tmp, file)
  }
  const nfc = (p: string): string => p.normalize('NFC')
  const removeAll = (pairs: [string, string][]): void => {
    const gone = new Set(pairs.map(([a, b]) => key(nfc(a), nfc(b))))
    save(load().filter(([x, y]) => !gone.has(key(x, y))))
  }
  return {
    list: load,
    add: (a, b) => save([...load(), [nfc(a), nfc(b)]]),
    remove: (a, b) => removeAll([[a, b]]),
    removeAll,
    movePath: (from, to) => {
      const [f, t] = [nfc(from), nfc(to)]
      save(load().map(([x, y]) => [x === f ? t : x, y === f ? t : y]))
    },
  }
}

export function followConversion(
  store: MatchingStore,
  job: { inputPath: string; replacesPath?: string },
  result: { outputPath: string; skipped?: boolean },
  exists: (path: string) => boolean,
): void {
  if (result.skipped) return
  for (const from of [job.inputPath, job.replacesPath]) {
    if (from && from !== result.outputPath && !exists(from)) store.movePath(from, result.outputPath)
  }
}
