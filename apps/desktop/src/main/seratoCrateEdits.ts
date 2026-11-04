import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildSeratoCrate } from '../shared/serato'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxPlaylistEdit,
} from '../shared/types'
import type { CrateStamp, EditOp, OpOutcome } from './rekordboxQueueOps'
import {
  type CrateTrack,
  crateFamily,
  crateFileOf,
  crateIdOf,
  crateTrackPaths,
  parseSeratoLinkId,
  renamedCrateId,
  seratoPathOn,
  seratoRootOf,
  validCrateName,
  withCrateTracks,
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

export function seratoNameTaken(
  draft: SeratoDraft,
  edit: RekordboxPlaylistEdit,
  roots: SeratoLibraryRoot[],
): boolean {
  if (edit.kind !== 'create' && edit.kind !== 'rename') return false
  const name = edit.name.trim()
  const family =
    edit.kind === 'rename'
      ? familyByRoot(draft, edit.playlistId, roots).flatMap(([, ids]) => ids)
      : []
  const taken = new Set(
    roots
      .flatMap((r) => crateIds(draft, r))
      .filter((id) => !family.includes(id))
      .map(lower),
  )
  if (edit.kind === 'create') return taken.has(lower(crateIdOf(edit.parentId, name)))
  return family.some((f) => taken.has(lower(renamedCrateId(f, edit.playlistId, name))))
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

type TrackEdit = Extract<RekordboxPlaylistEdit, { kind: 'add' | 'move' | 'remove' }>

function addTracks(
  draft: SeratoDraft,
  edit: Extract<TrackEdit, { kind: 'add' }>,
  roots: SeratoLibraryRoot[],
): { report: PlaylistAddReport; lists: Map<string, CrateTrack[]> } | 'unreadable' {
  const report: PlaylistAddReport = { added: 0, already: 0, notInCollection: 0, ambiguous: 0 }
  const lists = new Map<string, CrateTrack[]>()
  const present = new Map<string, Set<string>>()
  for (const track of edit.tracks) {
    const file = track.paths[track.paths.length - 1] ?? ''
    const root = seratoRootOf(file, roots)
    const crate = root ? crateFileOf(root, edit.playlistId) : null
    const bytes = crate ? draft.read(crate) : null
    if (!root || !crate || !bytes) {
      report.notInCollection++
      continue
    }
    const tracks = crateTrackPaths(bytes)
    if (!tracks) return 'unreadable'
    const path = seratoPathOn(file, root)
    const there = present.get(crate) ?? new Set(tracks.map((t) => t.normalize('NFC')))
    present.set(crate, there)
    if (there.has(path.normalize('NFC'))) report.already++
    else if (!existsSync(file)) report.notInCollection++
    else {
      there.add(path.normalize('NFC'))
      const list = lists.get(crate) ?? tracks.map((_, keep): CrateTrack => ({ keep }))
      lists.set(crate, [...list, { path }])
      report.added++
    }
  }
  return { report, lists }
}

type Refused = { refused: RekordboxEditRefusal; report?: PlaylistAddReport }

function rowsByCrate(
  draft: SeratoDraft,
  linkIds: string[],
): Map<string, { moving: Set<number>; tracks: string[] }> | Refused {
  const crates = new Map<string, { moving: Set<number>; tracks: string[] }>()
  for (const linkId of linkIds) {
    const link = parseSeratoLinkId(linkId)
    if (!link) return { refused: 'stale' }
    let crate = crates.get(link.crateFile)
    if (!crate) {
      const bytes = draft.read(link.crateFile)
      if (!bytes) return { refused: 'stale' }
      const tracks = crateTrackPaths(bytes)
      if (!tracks) return { refused: 'unreadable' }
      crate = { moving: new Set(), tracks }
      crates.set(link.crateFile, crate)
    }
    if (link.index >= crate.tracks.length) return { refused: 'stale' }
    crate.moving.add(link.index)
  }
  return crates
}

function editTracks(
  draft: SeratoDraft,
  edit: TrackEdit,
  roots: SeratoLibraryRoot[],
): { report?: PlaylistAddReport } | Refused {
  let lists: Map<string, CrateTrack[]>
  let report: PlaylistAddReport | undefined
  if (edit.kind === 'add') {
    const added = addTracks(draft, edit, roots)
    if (added === 'unreadable') return { refused: added }
    if (added.lists.size === 0) return { refused: 'nothing-to-add', report: added.report }
    lists = added.lists
    report = added.report
  } else {
    const crates = rowsByCrate(draft, edit.linkIds)
    if (!(crates instanceof Map)) return crates
    const own = new Set(roots.map((r) => crateFileOf(r, edit.playlistId)))
    if ([...crates.keys()].some((crate) => !own.has(crate))) return { refused: 'stale' }
    const beforeId = edit.kind === 'move' ? edit.beforeLinkId : null
    const before = beforeId === null ? null : parseSeratoLinkId(beforeId)
    if (beforeId !== null && !(before && crates.has(before.crateFile))) return { refused: 'stale' }
    if (edit.kind === 'move' && crates.size > 1) return { refused: 'stale' }
    lists = new Map()
    for (const [crate, { moving, tracks }] of crates) {
      const rows = tracks.map((_, keep) => keep)
      const rest = rows.filter((i) => !moving.has(i))
      if (edit.kind === 'remove') {
        lists.set(
          crate,
          rest.map((keep) => ({ keep })),
        )
        continue
      }
      const at = before ? rest.indexOf(before.index) : rest.length
      if (at === -1) return { refused: 'stale' }
      const next = [...rest.slice(0, at), ...rows.filter((i) => moving.has(i)), ...rest.slice(at)]
      lists.set(
        crate,
        next.map((keep) => ({ keep })),
      )
    }
  }
  for (const [crate, list] of lists) {
    const bytes = withCrateTracks(draft.read(crate) as Uint8Array, list)
    if (!bytes) return { refused: 'unreadable' }
    draft.write(crate, bytes)
  }
  return report ? { report } : {}
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
  if (edit.kind === 'create') {
    const name = edit.name.trim()
    if (!validCrateName(name)) return refused('bad-name')
    const targets = createRoots(draft, edit.parentId, roots)
    if (targets.length === 0) return refused('stale')
    const id = crateIdOf(edit.parentId, name)
    if (seratoNameTaken(draft, edit, roots)) return refused('bad-name')
    for (const r of targets)
      draft.write(crateFileOf(r, id), buildSeratoCrate([], crateFileOf(r, id)))
    return done({ createdId: id })
  }
  if (edit.kind === 'add' || edit.kind === 'move' || edit.kind === 'remove') {
    const result = editTracks(draft, edit, roots)
    if ('refused' in result)
      return { ...refused(result.refused), ...(result.report && { report: result.report }) }
    return done(result)
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
  if (seratoNameTaken(draft, edit, roots)) return refused('bad-name')
  const renamed = (f: string): string => renamedCrateId(f, id, name)
  for (const [r, family] of families)
    for (const f of family)
      if (renamed(f) !== f) draft.rename(crateFileOf(r, f), crateFileOf(r, renamed(f)))
  return done()
}
