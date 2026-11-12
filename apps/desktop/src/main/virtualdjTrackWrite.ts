import { existsSync, readFileSync, statSync } from 'node:fs'
import log from 'electron-log/main'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { OpOutcome, TagsOp, TrackOp } from './rekordboxQueueOps'
import type { SeratoTagField } from './seratoDatabaseWrite'
import { songIn } from './virtualdjCuesWrite'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import {
  virtualdjLengthWritable,
  withVirtualdjSongAdded,
  withVirtualdjSongMoved,
  withVirtualdjTags,
} from './virtualdjDatabaseWrite'
import { type VirtualdjRoot, virtualdjPathOf, virtualdjStoredPath } from './virtualdjLibrary'
import {
  commitVirtualdjDraft,
  createVirtualdjDraft,
  type VirtualdjCommit,
  type VirtualdjCommitDeps,
  type VirtualdjDraft,
  virtualdjDatabaseOf,
} from './virtualdjLibraryWrite'
import { readVirtualdjLists, type VirtualdjNode } from './virtualdjLists'
import { moveVirtualdjListRows, virtualdjListsDir } from './virtualdjListsWrite'

const ATTEMPTS = 3

export function virtualdjRootFor(path: string, roots: VirtualdjRoot[]): VirtualdjRoot | null {
  return (
    roots.find((r) => r.root !== '/' && path.startsWith(`${r.root}/`)) ??
    (path.startsWith('/Volumes/') ? null : roots.find((r) => r.root === '/')) ??
    null
  )
}

export function virtualdjHeld(roots: VirtualdjRoot[]): (path: string) => boolean {
  const held = new Set(
    roots.flatMap((root) => {
      const file = virtualdjDatabaseOf(root)
      if (!existsSync(file)) return []
      return parseVirtualdjDatabase(readFileSync(file, 'utf8')).map((s) =>
        virtualdjPathOf(root, s.path).normalize('NFC'),
      )
    }),
  )
  return (path) => held.has(path.normalize('NFC'))
}

function virtualdjListed(roots: VirtualdjRoot[]): (path: string) => boolean {
  const dir = virtualdjListsDir(roots)
  const listed = new Set(
    (dir ? readVirtualdjLists(dir) : []).flatMap(function paths(n: VirtualdjNode): string[] {
      return n.kind === 'playlist'
        ? n.paths.map((p) => p.normalize('NFC'))
        : (n.children ?? []).flatMap(paths)
    }),
  )
  return (path) => listed.has(path.normalize('NFC'))
}

export function virtualdjHeldOrListed(roots: VirtualdjRoot[]): (path: string) => boolean {
  const held = virtualdjHeld(roots)
  const listed = virtualdjListed(roots)
  return (path) => held(path) || listed(path)
}

export function virtualdjLibraryHas(
  roots: VirtualdjRoot[],
): (path: string, from?: string) => boolean {
  const has = virtualdjHeld(roots)
  return (path, from) =>
    !virtualdjRootFor(path, roots) || has(path) || (from !== undefined && has(from))
}

export async function virtualdjCannotFollow(
  roots: VirtualdjRoot[],
  from: string,
  to: string,
  lengthOf?: (path: string) => Promise<number | undefined>,
): Promise<boolean> {
  const key = (p: string) => p.normalize('NFC')
  for (const root of roots) {
    const file = virtualdjDatabaseOf(root)
    if (!existsSync(file)) continue
    const paths = parseVirtualdjDatabase(readFileSync(file, 'utf8')).map((s) =>
      key(virtualdjPathOf(root, s.path)),
    )
    if (!paths.includes(key(from))) continue
    if (virtualdjRootFor(to, roots) !== root || (key(to) !== key(from) && paths.includes(key(to))))
      return true
    const length = await lengthOf?.(to).catch(() => undefined)
    return length !== undefined && !virtualdjLengthWritable(length)
  }
  return false
}

function sizeOf(path: string): number | null {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

export function applyVirtualdjTrack(
  draft: VirtualdjDraft,
  op: TrackOp,
  roots: VirtualdjRoot[],
): OpOutcome {
  const done: OpOutcome = { id: op.id, applied: true, notices: [] }
  const notAdded: OpOutcome = {
    id: op.id,
    applied: false,
    notices: [{ code: 'not-added', track: op.label }],
  }
  if (songIn(draft, roots, op.path) || (!op.add && op.wanted.length === 0)) return done
  if (op.from && songIn(draft, roots, op.from))
    return {
      id: op.id,
      applied: op.wanted.length > 0,
      uncounted: true,
      notices: op.wanted.map((target) => ({
        code: 'source-in-virtualdj',
        track: op.label,
        playlist: target.name,
      })),
    }
  const root = virtualdjRootFor(op.path, roots)
  const file = root && virtualdjDatabaseOf(root)
  const xml = file && draft.read(file)
  const size = sizeOf(op.path)
  if (!root || !file || !xml || !op.meta || size === null) return notAdded
  const next = withVirtualdjSongAdded(xml, {
    path: virtualdjStoredPath(root, op.path, xml),
    size,
    title: op.meta.title,
    artist: op.meta.artist,
    album: op.meta.album,
    genre: op.meta.genre,
  })
  if (!next) return notAdded
  draft.write(file, next)
  return done
}

const TAG: Record<SeratoTagField, 'Title' | 'Author' | 'Album' | 'Genre'> = {
  tsng: 'Title',
  tart: 'Author',
  talb: 'Album',
  tgen: 'Genre',
}

const HELD: Record<SeratoTagField, 'title' | 'artist' | 'album' | 'genre'> = {
  tsng: 'title',
  tart: 'artist',
  talb: 'album',
  tgen: 'genre',
}

const sameText = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

export function applyVirtualdjTags(
  draft: VirtualdjDraft,
  op: TagsOp,
  roots: VirtualdjRoot[],
): OpOutcome {
  const refused = (code: 'tags-not-in-library' | 'tags-changed'): OpOutcome => ({
    id: op.id,
    applied: false,
    notices: [{ code, track: op.label }],
  })
  const found = songIn(draft, roots, op.path)
  if (!found) return refused('tags-not-in-library')
  const { file, xml, song } = found
  const from = Object.entries(op.from ?? {}) as [SeratoTagField, string][]
  const fields = Object.entries(op.fields) as [SeratoTagField, string][]
  if (fields.every(([tag, to]) => sameText(song[HELD[tag]], to)))
    return { id: op.id, applied: true, notices: [] }
  if (!from.every(([tag, was]) => sameText(song[HELD[tag]], was))) return refused('tags-changed')
  const tags: Partial<Record<'Title' | 'Author' | 'Album' | 'Genre', string>> = {}
  for (const [tag, value] of Object.entries(op.fields) as [SeratoTagField, string][])
    tags[TAG[tag]] = value
  const next = withVirtualdjTags(xml, song.path, tags)
  if (next === null) return refused('tags-not-in-library')
  draft.write(file, next)
  return { id: op.id, applied: true, notices: [] }
}

export interface VirtualdjRepointFacts {
  size: number | null
  lengthSeconds?: number
  endSeconds?: number
  bitrateKbps?: number
}

export interface VirtualdjAudio {
  sampleRate?: number
  bitrateKbps?: number
}

export function virtualdjBitrateKbps(probe: { bitRate?: number }): number | undefined {
  return probe.bitRate ? Math.round(probe.bitRate / 1000) : undefined
}

function movedSong(
  draft: VirtualdjDraft,
  repoint: RekordboxRepoint,
  facts: VirtualdjRepointFacts,
  roots: VirtualdjRoot[],
  listed: (path: string) => boolean,
): LibraryRepointResult {
  if (facts.size === null) return { written: false, reason: 'output-missing' }
  const found = songIn(draft, roots, repoint.from)
  const landed = (): LibraryRepointResult =>
    songIn(draft, roots, repoint.to)?.song.size === facts.size
      ? { written: true }
      : { written: false, reason: 'no-match' }
  if (!found) return listed(repoint.from) ? { written: true } : landed()
  const { root, file, xml, song } = found
  if (
    repoint.from === repoint.to &&
    (repoint.fromBytes === undefined || song.size !== repoint.fromBytes)
  )
    return landed()
  if (virtualdjRootFor(repoint.to, roots) !== root)
    return { written: false, reason: 'other-volume' }
  const wanted = repoint.to.normalize('NFC')
  const taken = parseVirtualdjDatabase(xml).some(
    (s) => s.path !== song.path && virtualdjPathOf(root, s.path).normalize('NFC') === wanted,
  )
  if (taken)
    return { written: false, reason: existsSync(repoint.from) ? 'song-taken' : 'song-taken-gone' }
  const path = virtualdjStoredPath(root, repoint.to, xml)
  const shift = repoint.engineShift
  if (facts.endSeconds !== undefined && !virtualdjLengthWritable(facts.endSeconds))
    return { written: false, reason: 'unwritable' }
  const moved = withVirtualdjSongMoved(
    xml,
    song.path,
    {
      path,
      size: facts.size,
      lengthSeconds: facts.lengthSeconds,
      bitrateKbps: facts.bitrateKbps ?? (repoint.from === repoint.to ? undefined : null),
    },
    -(shift?.trimmedMs ?? 0) / 1000,
    shift ? (facts.endSeconds ?? null) : null,
  )
  if (moved === null) return { written: false, reason: 'unwritable' }
  const names = repoint.names ?? {}
  const named = Object.values(names).some(Boolean)
    ? withVirtualdjTags(moved, path, {
        Title: names.title?.to,
        Author: names.artist?.to,
        Album: names.album?.to,
        Genre: names.genre?.to,
      })
    : moved
  draft.write(file, named ?? moved)
  return { written: true }
}

const QUEUE_REASON: Partial<Record<VirtualdjCommit, string>> = {
  cancelled: 'rekordbox-running',
  'write-unknown': 'write-failed',
}

export async function repointVirtualdjTracks(
  repoints: RekordboxRepoint[],
  deps: VirtualdjCommitDeps & {
    lengthOf: (path: string) => Promise<number | undefined>
    audioOf?: (path: string) => Promise<VirtualdjAudio>
  },
): Promise<LibraryRepointResult[]> {
  const facts = await Promise.all(
    repoints.map(async (r): Promise<VirtualdjRepointFacts> => {
      const size = sizeOf(r.to)
      if (size === null) return { size }
      const [probed, audio] = await Promise.all([
        deps.lengthOf(r.to).catch(() => undefined),
        deps.audioOf?.(r.to).catch(() => undefined),
      ])
      const samples = r.engineShift?.sampleCount
      const rate = r.engineShift?.sampleRateHz ?? audio?.sampleRate
      const lengthSeconds = samples && rate ? samples / rate : undefined
      const endSeconds = lengthSeconds ?? probed
      return {
        size,
        ...(lengthSeconds === undefined ? {} : { lengthSeconds }),
        ...(endSeconds === undefined ? {} : { endSeconds }),
        ...(audio?.bitrateKbps === undefined ? {} : { bitrateKbps: audio.bitrateKbps }),
      }
    }),
  )
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const draft = createVirtualdjDraft()
    const roots = deps.roots()
    const listed = virtualdjListed(roots)
    const results = repoints.map((r, i) => movedSong(draft, r, facts[i], roots, listed))
    const written = await commitVirtualdjDraft(draft, deps)
    if (written === 'changed') continue
    if (written !== 'written' && written !== 'nothing') {
      const reason = QUEUE_REASON[written] ?? written
      return repoints.map(() => ({ written: false, reason }))
    }
    const moves = repoints.flatMap((r, i) => {
      const size = facts[i].size
      return results[i].written && size !== null ? [{ from: r.from, to: r.to, size }] : []
    })
    if (moves.length > 0) {
      const lists = await moveVirtualdjListRows(moves, deps)
      if (lists !== 'written' && lists !== 'nothing') {
        log.warn(`VirtualDJ lists not moved to the converted files yet: ${lists}`)
        const reason = lists === 'cancelled' ? 'rekordbox-running' : 'write-failed'
        return repoints.map(() => ({ written: false, reason }))
      }
    }
    return results
  }
  log.info('VirtualDJ database kept changing while Surco moved its songs, nothing written')
  return repoints.map(() => ({ written: false, reason: 'rekordbox-running' }))
}
