import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { QueuedRepoint } from './rekordboxQueue'
import {
  repointSeratoCrate,
  repointSeratoDatabase,
  type SeratoMove,
  seratoDatabaseTruncated,
} from './seratoDatabase'
import type { SeratoLibraryRoot } from './seratoLibrary'

export interface SeratoRepointDeps {
  roots: () => SeratoLibraryRoot[]
  backupDir: string
  seratoOpen: () => Promise<boolean>
}

function inside(root: string, file: string): string | undefined {
  const relative = posix.relative(root, file)
  return relative && !relative.startsWith('..') && !posix.isAbsolute(relative)
    ? relative
    : undefined
}

function movesFor(root: string, repoints: QueuedRepoint[]): SeratoMove[] {
  return repoints.flatMap((r) => {
    const from = inside(root, r.from)
    const to = inside(root, r.to)
    return from && to && r.from !== r.to ? [{ from, to }] : []
  })
}

async function replace(file: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${file}.surco-tmp`
  await writeFile(tmp, bytes)
  await rename(tmp, file)
}

async function repointRoot(
  { dir, root }: SeratoLibraryRoot,
  moves: SeratoMove[],
  backupDir: string,
): Promise<Set<string>> {
  const databasePath = join(dir, 'database V2')
  const database = new Uint8Array(await readFile(databasePath))
  if (seratoDatabaseTruncated(database)) throw new Error('unreadable')
  const next = repointSeratoDatabase(database, moves)
  const subcrates = join(dir, 'Subcrates')
  const names = existsSync(subcrates)
    ? (await readdir(subcrates)).filter((n) => n.endsWith('.crate'))
    : []
  const crates: { name: string; bytes: Uint8Array }[] = []
  for (const name of names) {
    const before = new Uint8Array(await readFile(join(subcrates, name)))
    const after = repointSeratoCrate(before, moves)
    if (after !== before) crates.push({ name, bytes: after })
  }
  if (next.moved.length === 0 && crates.length === 0) return new Set()
  const stamp = join(backupDir, `${Date.now()}-${root.replaceAll('/', '_')}`)
  await mkdir(join(stamp, 'Subcrates'), { recursive: true })
  await copyFile(databasePath, join(stamp, 'database V2'))
  for (const { name } of crates)
    await copyFile(join(subcrates, name), join(stamp, 'Subcrates', name))
  if (next.moved.length > 0) await replace(databasePath, next.bytes)
  for (const { name, bytes } of crates) await replace(join(subcrates, name), bytes)
  return new Set(next.moved.map((m) => m.normalize('NFC')))
}

export async function repointSerato(
  repoints: QueuedRepoint[],
  deps: SeratoRepointDeps,
): Promise<LibraryRepointResult[]> {
  const all = (reason: string): LibraryRepointResult[] =>
    repoints.map(() => ({ written: false, reason }))
  if (await deps.seratoOpen().catch(() => true)) return all('rekordbox-running')
  const written = new Set<string>()
  for (const root of deps.roots()) {
    const moves = movesFor(root.root, repoints)
    if (moves.length === 0) continue
    try {
      for (const from of await repointRoot(root, moves, deps.backupDir))
        written.add(posix.join(root.root, from).normalize('NFC'))
    } catch (e) {
      return all((e as Error).message === 'unreadable' ? 'unreadable' : 'write-failed')
    }
  }
  return repoints.map((r) =>
    written.has(r.from.normalize('NFC'))
      ? { written: true }
      : { written: false, reason: 'no-match' },
  )
}
