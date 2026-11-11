import { existsSync, readFileSync, statSync } from 'node:fs'
import type { OpOutcome, TrackOp } from './rekordboxQueueOps'
import { songIn } from './virtualdjCuesWrite'
import { parseVirtualdjDatabase } from './virtualdjDatabase'
import { withVirtualdjSongAdded } from './virtualdjDatabaseWrite'
import { type VirtualdjRoot, virtualdjPathOf, virtualdjStoredPath } from './virtualdjLibrary'
import { type VirtualdjDraft, virtualdjDatabaseOf } from './virtualdjLibraryWrite'

export function virtualdjRootFor(path: string, roots: VirtualdjRoot[]): VirtualdjRoot | null {
  return (
    roots.find((r) => r.root !== '/' && path.startsWith(`${r.root}/`)) ??
    roots.find((r) => r.root === '/') ??
    null
  )
}

export function virtualdjLibraryHas(
  roots: VirtualdjRoot[],
): (path: string, from?: string) => boolean {
  const held = new Set(
    roots.flatMap((root) => {
      const file = virtualdjDatabaseOf(root)
      if (!existsSync(file)) return []
      return parseVirtualdjDatabase(readFileSync(file, 'utf8')).map((s) =>
        virtualdjPathOf(root, s.path).normalize('NFC'),
      )
    }),
  )
  const has = (path: string) => held.has(path.normalize('NFC'))
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
