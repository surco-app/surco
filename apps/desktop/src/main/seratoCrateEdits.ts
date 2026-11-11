import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSeratoCrate } from '../shared/serato'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxPlaylistEdit,
  RekordboxQueueNotice,
} from '../shared/types'
import type { CrateStamp, EditOp, OpOutcome, TagsOp, TrackOp } from './rekordboxQueueOps'
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
import { parseSeratoDatabase, type SeratoTrack } from './seratoDatabase'
import {
  type SeratoTagField,
  seratoDatabaseHas,
  seratoFileType,
  withSeratoTrackAdded,
  withSeratoTrackFields,
} from './seratoDatabaseWrite'
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
  if (edit.kind !== 'create' && edit.kind !== 'rename' && edit.kind !== 'moveNode') return false
  const family =
    edit.kind === 'create'
      ? []
      : familyByRoot(draft, edit.playlistId, roots).flatMap(([, ids]) => ids)
  const taken = new Set(
    roots
      .flatMap((r) => crateIds(draft, r))
      .filter((id) => !family.includes(id))
      .map(lower),
  )
  if (edit.kind === 'moveNode') return family.some((f) => taken.has(lower(movedCrateId(f, edit))))
  const name = edit.name.trim()
  if (edit.kind === 'create') return taken.has(lower(crateIdOf(edit.parentId, name)))
  return family.some((f) => taken.has(lower(renamedCrateId(f, edit.playlistId, name))))
}

const crateName = (id: string): string => id.split('%%').pop() ?? id

function movedCrateId(
  id: string,
  edit: Extract<RekordboxPlaylistEdit, { kind: 'moveNode' }>,
): string {
  return crateIdOf(edit.parentId, crateName(edit.playlistId)) + id.slice(edit.playlistId.length)
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
  if (edit.kind !== 'rename' && edit.kind !== 'delete' && edit.kind !== 'moveNode') return files
  const families = familyByRoot(draft, id, roots)
  for (const [r, family] of families) for (const f of family) stamp(crateFileOf(r, f))
  if (edit.kind === 'rename' && !caseOnly(id, edit.name.trim()))
    for (const [r, family] of families)
      for (const f of family) files[crateFileOf(r, renamedCrateId(f, id, edit.name.trim()))] = null
  if (edit.kind === 'moveNode' && movedCrateId(id, edit) !== id)
    for (const [r, family] of families)
      for (const f of family) files[crateFileOf(r, movedCrateId(f, edit))] = null
  return files
}

type TrackEdit = Extract<RekordboxPlaylistEdit, { kind: 'add' | 'move' | 'remove' }>

interface Working {
  source: Uint8Array
  current: Uint8Array
  base: string[]
  rows: CrateTrack[]
}

const working = new WeakMap<SeratoDraft, Map<string, Working>>()
const renames = new WeakMap<SeratoDraft, Map<string, string>>()

function recordRename(draft: SeratoDraft, from: string, to: string): void {
  const moved = renames.get(draft) ?? new Map<string, string>()
  const origins = [...moved].filter(([, at]) => at === from).map(([origin]) => origin)
  if (!moved.has(from)) origins.push(from)
  for (const origin of origins) moved.set(origin, to)
  renames.set(draft, moved)
}

const whereIs = (draft: SeratoDraft, file: string): string => renames.get(draft)?.get(file) ?? file

function workingCrate(
  draft: SeratoDraft,
  file: string,
): Working | RekordboxEditRefusal | 'gone' | 'missing' {
  const original = draft.original(file)
  const bytes = draft.read(whereIs(draft, file))
  if (!bytes) return original ? 'gone' : 'missing'
  const seen = working.get(draft)?.get(file)
  if (seen) return seen.current === bytes ? seen : 'stale'
  const source = original ?? bytes
  if (bytes !== source) return 'stale'
  const base = crateTrackPaths(source)
  if (!base) return 'unreadable'
  return { source, current: source, base, rows: base.map((_, keep) => ({ keep })) }
}

const pathOfRow = (crate: Working, row: CrateTrack): string =>
  'keep' in row ? (crate.base[row.keep] ?? '') : row.path

function writeRows(
  draft: SeratoDraft,
  file: string,
  crate: Working,
  rows: CrateTrack[],
): RekordboxEditRefusal | null {
  const bytes = withCrateTracks(crate.source, rows)
  if (!bytes) return 'unreadable'
  draft.write(whereIs(draft, file), bytes)
  const crates = working.get(draft) ?? new Map<string, Working>()
  crates.set(file, { ...crate, current: bytes, rows })
  working.set(draft, crates)
  return null
}

type Refused = { refused: RekordboxEditRefusal; report?: PlaylistAddReport }

function addTracks(
  draft: SeratoDraft,
  edit: Extract<TrackEdit, { kind: 'add' }>,
  roots: SeratoLibraryRoot[],
): { report?: PlaylistAddReport } | Refused {
  const report: PlaylistAddReport = { added: 0, already: 0, notInCollection: 0, ambiguous: 0 }
  const lists = new Map<string, { crate: Working; rows: CrateTrack[]; there: Set<string> }>()
  let gone = false
  for (const track of edit.tracks) {
    const file = track.paths[track.paths.length - 1] ?? ''
    const root = seratoRootOf(file, roots)
    const crateFile = root ? crateFileOf(root, edit.playlistId) : null
    let list = crateFile ? lists.get(crateFile) : undefined
    if (root && crateFile && !list) {
      const crate = workingCrate(draft, crateFile)
      if (crate === 'stale' || crate === 'unreadable') return { refused: crate }
      if (crate === 'gone') gone = true
      if (typeof crate !== 'string') {
        const there = new Set(crate.rows.map((row) => pathOfRow(crate, row).normalize('NFC')))
        list = { crate, rows: [...crate.rows], there }
        lists.set(crateFile, list)
      }
    }
    if (!root || !list) {
      report.notInCollection++
      continue
    }
    const path = seratoPathOn(file, root)
    if (list.there.has(path.normalize('NFC'))) report.already++
    else if (!existsSync(file)) report.notInCollection++
    else {
      list.there.add(path.normalize('NFC'))
      list.rows.push({ path })
      report.added++
    }
  }
  if (report.added === 0) return gone ? {} : { refused: 'nothing-to-add', report }
  for (const [crateFile, { crate, rows }] of lists) {
    if (rows.length === crate.rows.length) continue
    const failed = writeRows(draft, crateFile, crate, rows)
    if (failed) return { refused: failed }
  }
  return { report }
}

function rowsByCrate(
  draft: SeratoDraft,
  linkIds: string[],
  own: Set<string>,
): Map<string, { crate: Working; positions: number[] }> | Refused | 'gone' {
  const crates = new Map<string, { crate: Working; positions: number[] }>()
  for (const linkId of linkIds) {
    const link = parseSeratoLinkId(linkId)
    if (!link || !own.has(link.crateFile)) return { refused: 'stale' }
    let entry = crates.get(link.crateFile)
    if (!entry) {
      const crate = workingCrate(draft, link.crateFile)
      if (crate === 'gone') return crate
      if (crate === 'missing') return { refused: 'stale' }
      if (typeof crate === 'string') return { refused: crate }
      entry = { crate, positions: [] }
      crates.set(link.crateFile, entry)
    }
    const seen = entry.crate.base[link.index]
    const at = entry.crate.rows.findIndex((row) => 'keep' in row && row.keep === link.index)
    if (seen?.normalize('NFC') !== link.path.normalize('NFC') || at === -1)
      return { refused: 'stale' }
    entry.positions.push(at)
  }
  return crates
}

function editTracks(
  draft: SeratoDraft,
  edit: TrackEdit,
  roots: SeratoLibraryRoot[],
): { report?: PlaylistAddReport } | Refused {
  if (edit.kind === 'add') return addTracks(draft, edit, roots)
  const own = new Set(roots.map((r) => crateFileOf(r, edit.playlistId)))
  const beforeId = edit.kind === 'move' ? edit.beforeLinkId : null
  const crates = rowsByCrate(
    draft,
    beforeId === null ? edit.linkIds : [...edit.linkIds, beforeId],
    own,
  )
  if (crates === 'gone') return {}
  if (!(crates instanceof Map)) return crates
  if (edit.kind === 'move' && crates.size > 1) return { refused: 'stale' }
  const writes: [string, Working, CrateTrack[]][] = []
  for (const [file, { crate, positions }] of crates) {
    const before = beforeId === null ? undefined : positions.pop()
    const moving = new Set(positions)
    const rows = crate.rows.map((_, i) => i)
    const rest = rows.filter((i) => !moving.has(i))
    let next = rest
    if (edit.kind === 'move') {
      const at = before === undefined ? rest.length : rest.indexOf(before)
      if (at === -1) return { refused: 'stale' }
      next = [...rest.slice(0, at), ...rows.filter((i) => moving.has(i)), ...rest.slice(at)]
    }
    writes.push([file, crate, next.map((i) => crate.rows[i])])
  }
  for (const [file, crate, rows] of writes) {
    const failed = writeRows(draft, file, crate, rows)
    if (failed) return { refused: failed }
  }
  return {}
}

function staleOrUnreadable(draft: SeratoDraft, op: EditOp): RekordboxEditRefusal | null {
  for (const [file, seen] of Object.entries(op.files ?? {})) {
    const bytes = draft.original(file)
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
    if (!edit.tracks) return done({ createdId: id })
    const filled = addTracks(draft, { kind: 'add', playlistId: id, tracks: edit.tracks }, roots)
    if ('refused' in filled && filled.refused !== 'nothing-to-add') return refused(filled.refused)
    return done({ createdId: id, ...(filled.report && { report: filled.report }) })
  }
  if (edit.kind === 'add' || edit.kind === 'move' || edit.kind === 'remove') {
    const result = editTracks(draft, edit, roots)
    if ('refused' in result)
      return { ...refused(result.refused), ...(result.report && { report: result.report }) }
    return done(result)
  }
  if (edit.kind !== 'rename' && edit.kind !== 'delete' && edit.kind !== 'moveNode')
    return refused('write-failed')
  const id = edit.playlistId
  if (edit.kind === 'moveNode') {
    if (edit.parentId === id || edit.parentId.startsWith(`${id}%%`)) return refused('stale')
    if (familyByRoot(draft, id, roots).length === 0) return refused('stale')
    if (createRoots(draft, edit.parentId, roots).length === 0) return refused('stale')
  }
  const families = familyByRoot(draft, id, roots)
  if (families.length === 0) return refused('stale')
  for (const [r, family] of families)
    if (family.some((f) => !readable(draft, crateFileOf(r, f)))) return refused('unreadable')
  if (edit.kind === 'delete') {
    for (const [r, family] of families) for (const f of family) draft.remove(crateFileOf(r, f))
    return done()
  }
  if (edit.kind === 'moveNode' && seratoNameTaken(draft, edit, roots)) return refused('bad-name')
  const name = edit.kind === 'moveNode' ? '' : edit.name.trim()
  if (edit.kind === 'rename' && !validCrateName(name)) return refused('bad-name')
  if (edit.kind === 'rename' && seratoNameTaken(draft, edit, roots)) return refused('bad-name')
  const renamed = (f: string): string =>
    edit.kind === 'moveNode' ? movedCrateId(f, edit) : renamedCrateId(f, id, name)
  for (const [r, family] of families)
    for (const f of family)
      if (renamed(f) !== f) {
        draft.rename(crateFileOf(r, f), crateFileOf(r, renamed(f)))
        recordRename(draft, crateFileOf(r, f), crateFileOf(r, renamed(f)))
      }
  return done()
}

const DATABASE = 'database V2'

type Read = (file: string) => Uint8Array | null

function databaseHolds(read: Read, roots: SeratoLibraryRoot[], path: string): boolean {
  const root = seratoRootOf(path, roots)
  const bytes = root && read(join(root.dir, DATABASE))
  return !!root && !!bytes && seratoDatabaseHas(bytes, seratoPathOn(path, root))
}

export function seratoLibraryHas(
  roots: SeratoLibraryRoot[],
): (path: string, from?: string) => boolean {
  const cache = new Map<string, Uint8Array | null>()
  const read: Read = (file) => {
    if (!cache.has(file)) cache.set(file, existsSync(file) ? readFileSync(file) : null)
    return cache.get(file) ?? null
  }
  return (path, from) =>
    !seratoRootOf(path, roots) ||
    databaseHolds(read, roots, path) ||
    (!!from && databaseHolds(read, roots, from))
}

type Pick = { file: string } | { missing: 'other-volume' | 'playlist-gone' }

function pickedCrate(
  draft: SeratoDraft,
  target: TrackOp['wanted'][number],
  root: SeratoLibraryRoot,
  roots: SeratoLibraryRoot[],
): Pick {
  if (target.id) {
    const file = crateFileOf(root, target.id)
    if (draft.read(whereIs(draft, file))) return { file }
    const elsewhere = roots.some((r) => r !== root && draft.exists(crateFileOf(r, target.id ?? '')))
    return { missing: draft.original(file) || !elsewhere ? 'playlist-gone' : 'other-volume' }
  }
  const name = target.name.trim()
  if (!validCrateName(name)) return { missing: 'playlist-gone' }
  const id = crateIds(draft, root).find((c) => lower(c) === lower(name)) ?? name
  return { file: crateFileOf(root, id) }
}

function fileInCrates(
  draft: SeratoDraft,
  op: TrackOp,
  root: SeratoLibraryRoot,
  roots: SeratoLibraryRoot[],
  path: string,
): RekordboxQueueNotice[] {
  const notices: RekordboxQueueNotice[] = []
  const key = path.normalize('NFC')
  const holds = (crate: Working): boolean =>
    crate.rows.some((row) => pathOfRow(crate, row).normalize('NFC') === key)
  const wanted = new Set<string>()
  for (const target of op.wanted) {
    const pick = pickedCrate(draft, target, root, roots)
    if ('missing' in pick) {
      notices.push({ code: pick.missing, track: op.label, playlist: target.name })
      continue
    }
    const { file } = pick
    if (!draft.exists(file)) draft.write(file, buildSeratoCrate([], file))
    wanted.add(whereIs(draft, file))
    const crate = workingCrate(draft, file)
    if (typeof crate === 'string') {
      notices.push({ code: 'playlist-changed', track: op.label, playlist: target.name })
      continue
    }
    if (!holds(crate)) writeRows(draft, file, crate, [...crate.rows, { path }])
  }
  const known = new Set(op.known.map((id) => whereIs(draft, crateFileOf(root, id))))
  for (const id of crateIds(draft, root)) {
    const file = crateFileOf(root, id)
    if (wanted.has(file)) continue
    const crate = workingCrate(draft, file)
    if (typeof crate === 'string' || !holds(crate)) continue
    if (!known.has(file)) {
      notices.push({ code: 'playlist-changed', track: op.label, playlist: crateName(id) })
      continue
    }
    writeRows(
      draft,
      file,
      crate,
      crate.rows.filter((row) => pathOfRow(crate, row).normalize('NFC') !== key),
    )
  }
  return notices
}

export function applySeratoTrack(
  draft: SeratoDraft,
  op: TrackOp,
  roots: SeratoLibraryRoot[],
  now: Date,
): OpOutcome {
  const notAdded: OpOutcome = {
    id: op.id,
    applied: false,
    notices: [{ code: 'not-added', track: op.label }],
  }
  const root = seratoRootOf(op.path, roots)
  if (!root && !op.add && op.wanted.length > 0)
    return {
      id: op.id,
      applied: false,
      notices: op.wanted.map((target) => ({
        code: 'other-volume',
        track: op.label,
        playlist: target.name,
      })),
    }
  const database = root && join(root.dir, DATABASE)
  const bytes = database && draft.read(database)
  if (!root || !database || !bytes) return notAdded
  const path = seratoPathOn(op.path, root)
  if (!seratoDatabaseHas(bytes, path) && (op.add || op.wanted.length > 0)) {
    if (op.from && databaseHolds((file) => draft.read(file), roots, op.from))
      return {
        id: op.id,
        applied: op.wanted.length > 0,
        uncounted: true,
        notices: op.wanted.map((target) => ({
          code: 'source-in-serato',
          track: op.label,
          playlist: target.name,
        })),
      }
    const picks = op.wanted.map((target) => ({
      target,
      pick: pickedCrate(draft, target, root, roots),
    }))
    if (!op.add && picks.every(({ pick }) => 'missing' in pick))
      return {
        id: op.id,
        applied: true,
        uncounted: true,
        notices: picks.flatMap(({ target, pick }) =>
          'missing' in pick ? [{ code: pick.missing, track: op.label, playlist: target.name }] : [],
        ),
      }
    const type = seratoFileType(op.path)
    const added =
      op.meta &&
      type &&
      withSeratoTrackAdded(bytes, {
        pfil: path,
        type,
        title: op.meta.title,
        artist: op.meta.artist,
        album: op.meta.album,
        genre: op.meta.genre,
        addedAt: Math.floor(now.getTime() / 1000),
      })
    if (!added) return notAdded
    draft.write(database, added)
  }
  if (op.wanted.length === 0 && op.known.length === 0)
    return { id: op.id, applied: true, notices: [] }
  return { id: op.id, applied: true, notices: fileInCrates(draft, op, root, roots, path) }
}

const HELD: Record<SeratoTagField, keyof SeratoTrack> = {
  tsng: 'title',
  tart: 'artist',
  talb: 'album',
  tgen: 'genre',
}

const sameText = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

export function applySeratoTags(
  draft: SeratoDraft,
  op: TagsOp,
  roots: SeratoLibraryRoot[],
): OpOutcome {
  const refused = (code: 'tags-not-in-library' | 'tags-changed'): OpOutcome => ({
    id: op.id,
    applied: false,
    notices: [{ code, track: op.label }],
  })
  const root = seratoRootOf(op.path, roots)
  const database = root && join(root.dir, DATABASE)
  const bytes = database && draft.read(database)
  if (!root || !database || !bytes) return refused('tags-not-in-library')
  const pfil = seratoPathOn(op.path, root)
  const held = parseSeratoDatabase(bytes).find((t) => sameText(t.path, pfil))
  if (!held) return refused('tags-not-in-library')
  const from = Object.entries(op.from ?? {}) as [SeratoTagField, string][]
  if (!from.every(([tag, was]) => sameText(String(held[HELD[tag]] ?? ''), was)))
    return refused('tags-changed')
  const tagged = withSeratoTrackFields(bytes, pfil, op.fields)
  if (!tagged) return refused('tags-not-in-library')
  draft.write(database, tagged)
  return { id: op.id, applied: true, notices: [] }
}
