import { existsSync, readFileSync, statSync } from 'node:fs'
import type { OpOutcome, TagsOp, TrackOp } from './rekordboxQueueOps'
import type { SeratoTagField } from './seratoDatabaseWrite'
import { songIn } from './virtualdjCuesWrite'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import { withVirtualdjSongAdded, withVirtualdjTags } from './virtualdjDatabaseWrite'
import { type VirtualdjRoot, virtualdjPathOf, virtualdjStoredPath } from './virtualdjLibrary'
import { type VirtualdjDraft, virtualdjDatabaseOf } from './virtualdjLibraryWrite'

export function virtualdjRootFor(path: string, roots: VirtualdjRoot[]): VirtualdjRoot | null {
  return (
    roots.find((r) => r.root !== '/' && path.startsWith(`${r.root}/`)) ??
    roots.find((r) => r.root === '/') ??
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

export function virtualdjLibraryHas(
  roots: VirtualdjRoot[],
): (path: string, from?: string) => boolean {
  const has = virtualdjHeld(roots)
  return (path, from) =>
    !virtualdjRootFor(path, roots) || has(path) || (from !== undefined && has(from))
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
  if (!from.every(([tag, was]) => sameText(song[HELD[tag]], was))) return refused('tags-changed')
  const tags: Partial<Record<'Title' | 'Author' | 'Album' | 'Genre', string>> = {}
  for (const [tag, value] of Object.entries(op.fields) as [SeratoTagField, string][])
    tags[TAG[tag]] = value
  const next = withVirtualdjTags(xml, song.path, tags)
  if (next === null) return refused('tags-not-in-library')
  draft.write(file, next)
  return { id: op.id, applied: true, notices: [] }
}
