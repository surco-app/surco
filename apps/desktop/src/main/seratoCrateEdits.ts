import { join } from 'node:path'
import { buildSeratoCrate } from '../shared/serato'
import type { RekordboxEditRefusal, RekordboxPlaylistEdit } from '../shared/types'
import type { CrateStamp, EditOp, OpOutcome } from './rekordboxQueueOps'
import {
  crateFamily,
  crateFileOf,
  crateIdOf,
  crateTrackPaths,
  renamedCrateId,
  validCrateName,
} from './seratoCrateFile'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { createSeratoDraft, type SeratoDraft } from './seratoLibraryWrite'

const CRATE = '.crate'

function crateIds(draft: SeratoDraft, root: SeratoLibraryRoot): string[] {
  return draft
    .list(join(root.dir, 'Subcrates'))
    .filter((name) => name.endsWith(CRATE))
    .map((name) => name.slice(0, -CRATE.length))
}

const lower = (id: string): string => id.toLowerCase()

function readable(draft: SeratoDraft, file: string): boolean {
  const bytes = draft.read(file)
  return bytes !== null && crateTrackPaths(bytes) !== null
}

function createRoots(
  draft: SeratoDraft,
  parentId: string,
  roots: SeratoLibraryRoot[],
): SeratoLibraryRoot[] {
  if (parentId === 'root') {
    const home = roots.find((r) => r.root === '/') ?? roots[0]
    return home ? [home] : []
  }
  return roots.filter((r) => draft.exists(crateFileOf(r, parentId)))
}

function familyByRoot(
  draft: SeratoDraft,
  id: string,
  roots: SeratoLibraryRoot[],
): [SeratoLibraryRoot, string[]][] {
  return roots
    .map((r): [SeratoLibraryRoot, string[]] => [r, crateFamily(crateIds(draft, r), id)])
    .filter(([, family]) => family.length > 0)
}

const caseOnly = (id: string, name: string): boolean =>
  lower(renamedCrateId(id, id, name)) === lower(id)

export function seratoEditFiles(
  edit: RekordboxPlaylistEdit,
  roots: SeratoLibraryRoot[],
): Record<string, CrateStamp | null> {
  const draft = createSeratoDraft()
  const files: Record<string, CrateStamp | null> = {}
  const stamp = (file: string): void => {
    const bytes = draft.read(file)
    const tracks = bytes && crateTrackPaths(bytes)
    if (tracks) files[file] = { tracks }
  }
  if (edit.kind === 'create') {
    const name = edit.name.trim()
    for (const r of createRoots(draft, edit.parentId, roots)) {
      if (edit.parentId !== 'root') stamp(crateFileOf(r, edit.parentId))
      files[crateFileOf(r, crateIdOf(edit.parentId, name))] = null
    }
    return files
  }
  const id = edit.playlistId
  if (edit.kind !== 'rename' && edit.kind !== 'delete') {
    for (const r of roots) if (draft.exists(crateFileOf(r, id))) stamp(crateFileOf(r, id))
    return files
  }
  const families = familyByRoot(draft, id, roots)
  for (const [r, family] of families) for (const f of family) stamp(crateFileOf(r, f))
  if (edit.kind === 'rename' && !caseOnly(id, edit.name.trim()))
    for (const [r, family] of families)
      for (const f of family) files[crateFileOf(r, renamedCrateId(f, id, edit.name.trim()))] = null
  return files
}

function staleOrUnreadable(draft: SeratoDraft, op: EditOp): RekordboxEditRefusal | null {
  for (const [file, seen] of Object.entries(op.files ?? {})) {
    const bytes = draft.read(file)
    if (seen === null && bytes === null) continue
    if (seen === null || bytes === null) return 'stale'
    const tracks = crateTrackPaths(bytes)
    if (!tracks) return 'unreadable'
    if (tracks.length !== seen.tracks.length || tracks.some((t, i) => t !== seen.tracks[i]))
      return 'stale'
  }
  return null
}

export function applySeratoEdit(
  draft: SeratoDraft,
  op: EditOp,
  roots: SeratoLibraryRoot[],
): OpOutcome {
  const refused = (reason: RekordboxEditRefusal): OpOutcome => ({
    id: op.id,
    applied: false,
    reason,
    notices: reason === 'stale' ? [{ code: 'edit-changed', playlist: op.label ?? '' }] : [],
  })
  const done = (extra: Partial<OpOutcome> = {}): OpOutcome => ({
    id: op.id,
    applied: true,
    notices: [],
    ...extra,
  })
  const before = staleOrUnreadable(draft, op)
  if (before) return refused(before)
  const { edit } = op
  const taken = (except: string[]): Set<string> =>
    new Set(
      roots
        .flatMap((r) => crateIds(draft, r))
        .filter((id) => !except.includes(id))
        .map(lower),
    )
  if (edit.kind === 'create') {
    const name = edit.name.trim()
    if (!validCrateName(name)) return refused('bad-name')
    const targets = createRoots(draft, edit.parentId, roots)
    if (targets.length === 0) return refused('stale')
    const id = crateIdOf(edit.parentId, name)
    if (taken([]).has(lower(id))) return refused('bad-name')
    for (const r of targets)
      draft.write(crateFileOf(r, id), buildSeratoCrate([], crateFileOf(r, id)))
    return done({ createdId: id })
  }
  if (edit.kind !== 'rename' && edit.kind !== 'delete') return refused('write-failed')
  const id = edit.playlistId
  const families = familyByRoot(draft, id, roots)
  if (families.length === 0) return refused('stale')
  for (const [r, family] of families)
    if (family.some((f) => !readable(draft, crateFileOf(r, f)))) return refused('unreadable')
  if (edit.kind === 'delete') {
    for (const [r, family] of families) for (const f of family) draft.remove(crateFileOf(r, f))
    return done()
  }
  const name = edit.name.trim()
  if (!validCrateName(name)) return refused('bad-name')
  const others = taken(families.flatMap(([, family]) => family))
  const renamed = (f: string): string => renamedCrateId(f, id, name)
  if (families.some(([, family]) => family.some((f) => others.has(lower(renamed(f))))))
    return refused('bad-name')
  for (const [r, family] of families)
    for (const f of family)
      if (renamed(f) !== f) draft.rename(crateFileOf(r, f), crateFileOf(r, renamed(f)))
  return done()
}
