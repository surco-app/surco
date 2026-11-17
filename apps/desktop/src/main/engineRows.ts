import { basename, resolve } from 'node:path'

// Engine stores each path relative to the library folder, forward-slashed. Matching
// compares the absolute, resolved form; NFC first, because APFS treats NFC and NFD names as
// one file while a byte compare would not.
export function absolute(libraryDir: string, stored: string): string {
  return resolve(libraryDir, stored).normalize('NFC')
}

// The rows whose stored path resolves to a file. Resolving pays an lstat per path
// component, on a NAS hundreds of ms per hundred rows, and the library holds every track
// the DJ owns. The links a library is reached through are folders, so a file keeps its
// name through them: only rows of the same name, compared case-insensitively as pathKey
// does, are resolved at all, the narrowing rekordbox's candidateRows makes by FileNameL.
export function engineRowFinder<T extends { path: string }>(
  libraryDir: string,
  rows: T[],
): (file: string, key: (path: string) => string) => T[] {
  const byName = new Map<string, { row: T; at: string }[]>()
  for (const row of rows) {
    const at = absolute(libraryDir, row.path)
    const name = basename(at).toLowerCase()
    const same = byName.get(name)
    if (same) same.push({ row, at })
    else byName.set(name, [{ row, at }])
  }
  return (file, key) => {
    const nfc = file.normalize('NFC')
    const sameName = byName.get(basename(nfc).toLowerCase())
    if (!sameName) return []
    const target = key(nfc)
    return sameName.filter((c) => key(c.at) === target).map((c) => c.row)
  }
}
