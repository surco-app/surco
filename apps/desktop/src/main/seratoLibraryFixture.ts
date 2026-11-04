import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSeratoCrate, concat, frame, rawFramesOf, textFrame } from '../shared/serato'
import type { RekordboxPlaylistEdit } from '../shared/types'
import type { CrateStamp, EditOp, OpOutcome } from './rekordboxQueueOps'
import { applySeratoLibraryOps } from './seratoBatch'
import { crateFileOf, withCrateTracks } from './seratoCrateFile'
import type { SeratoLibraryRoot } from './seratoLibrary'
import type { SeratoCommitDeps } from './seratoLibraryWrite'

export const crateBytes = (tracks: string[]): Buffer =>
  Buffer.from(buildSeratoCrate(tracks.map((t) => ({ inputPath: `/${t}` }))))

export type TestDeps = SeratoCommitDeps & { roots: () => SeratoLibraryRoot[] }

export function twoRoots(crates: { internal?: string[]; gig?: string[] }) {
  const base = mkdtempSync(join(tmpdir(), 'surco-serato-lib-'))
  const roots: SeratoLibraryRoot[] = [
    { dir: join(base, 'home', 'Music', '_Serato_'), root: '/' },
    { dir: join(base, 'Volumes', 'Gig', '_Serato_'), root: join(base, 'Volumes', 'Gig') },
  ]
  const bytes: Record<'internal' | 'gig', Record<string, Buffer>> = { internal: {}, gig: {} }
  for (const [i, side] of (['internal', 'gig'] as const).entries()) {
    mkdirSync(join(roots[i].dir, 'Subcrates'), { recursive: true })
    for (const id of crates[side] ?? []) {
      const b = crateBytes([`Users/dj/${side}/${id}.mp3`])
      writeFileSync(crateFileOf(roots[i], id), b)
      bytes[side][id] = b
    }
  }
  const deps: TestDeps = {
    backupDir: join(base, 'serato-backups'),
    roots: () => roots,
    seratoOpen: async () => false,
  }
  return { roots, deps, bytes }
}

export const create = (parentId: string, name: string): RekordboxPlaylistEdit => ({
  kind: 'create',
  parentId,
  name,
  folder: false,
})
export const rename = (playlistId: string, name: string): RekordboxPlaylistEdit => ({
  kind: 'rename',
  playlistId,
  name,
})
export const del = (playlistId: string): RekordboxPlaylistEdit => ({ kind: 'delete', playlistId })

let next = 0
export const editOp = (
  edit: RekordboxPlaylistEdit,
  files?: Record<string, CrateStamp | null>,
): EditOp => ({
  id: `e${++next}`,
  kind: 'edit',
  edit,
  stamps: {},
  label: 'Crate',
  ...(files && { files }),
})

export async function applyOne(op: EditOp, deps: TestDeps): Promise<OpOutcome> {
  const result = await applySeratoLibraryOps([op], { ...deps, ensureClosed: async () => true })
  if (!result.ok) throw new Error(`batch refused: ${result.reason}`)
  return result.outcomes[0]
}

export async function apply(
  _roots: SeratoLibraryRoot[],
  deps: TestDeps,
  ...edits: RekordboxPlaylistEdit[]
): Promise<OpOutcome> {
  const result = await applySeratoLibraryOps(
    edits.map((e) => editOp(e)),
    { ...deps, ensureClosed: async () => true },
  )
  if (!result.ok) throw new Error(`batch refused: ${result.reason}`)
  return result.outcomes[result.outcomes.length - 1]
}

export const listCrates = (root: SeratoLibraryRoot): string[] =>
  readdirSync(join(root.dir, 'Subcrates')).sort()

export function touch(file: string, track: string): void {
  const bytes = withCrateTracks(readFileSync(file), [{ keep: 0 }, { path: track }])
  if (!bytes) throw new Error(`unreadable ${file}`)
  writeFileSync(file, bytes)
}

export function rewrittenBySerato(file: string, at: Date): void {
  const frames = rawFramesOf(readFileSync(file))
  if (!frames) throw new Error(`unreadable ${file}`)
  const column = frame('ovct', concat([textFrame('tvcn', 'grouping'), textFrame('tvcw', '77')]))
  const first = frames.findIndex((f) => f.tag === 'otrk')
  const raws = frames.map((f) => f.raw)
  raws.splice(first === -1 ? raws.length : first, 0, column)
  writeFileSync(file, concat(raws))
  utimesSync(file, at, at)
}

export function tempsUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(d, name.name))
      else if (/\.surco-(tmp|write)$/.test(name.name)) out.push(join(d, name.name))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

export function onlyBackupOf(backupDir: string, rel: string): string {
  const folders = readdirSync(backupDir)
  if (folders.length !== 1) throw new Error(`${folders.length} backup folders`)
  return join(backupDir, folders[0], rel)
}
