import { statSync } from 'node:fs'
import log from 'electron-log/main'
import type { DuplicatePair } from '../shared/types'
import type { DuplicateReplaceResult } from './rekordboxDuplicates'
import { songIn } from './virtualdjCuesWrite'
import { withVirtualdjSongMoved, withVirtualdjSongRemoved } from './virtualdjDatabaseWrite'
import { readVirtualdjLibrary, type VirtualdjRoot, virtualdjStoredPath } from './virtualdjLibrary'
import {
  commitVirtualdjDraft,
  createVirtualdjDraft,
  type VirtualdjCommitDeps,
  type VirtualdjDraft,
} from './virtualdjLibraryWrite'
import { moveVirtualdjListRows } from './virtualdjListsWrite'
import { virtualdjPathKey } from './virtualdjPaths'
import { type VirtualdjAudio, virtualdjRootFor } from './virtualdjTrackWrite'

const ATTEMPTS = 3
const RUNNING = 'virtualdj-running'

function sizeOf(path: string): number | null {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

function replacedSong(
  draft: VirtualdjDraft,
  pair: DuplicatePair,
  roots: VirtualdjRoot[],
  size: number | null,
  bitrateKbps: number | undefined,
): DuplicateReplaceResult | null {
  const found = songIn(draft, roots, pair.from)
  if (!found) return null
  const { root, file, xml, song } = found
  const kept = songIn(draft, roots, pair.to)
  if (kept) {
    if (kept.file === file && kept.song.path === song.path) return null
    const without = withVirtualdjSongRemoved(xml, song.path)
    if (without === null) return { written: false, reason: 'unwritable' }
    draft.write(file, without)
    return { written: true, outcome: 'replaced' }
  }
  if (virtualdjRootFor(pair.to, roots) !== root) return { written: false, reason: 'other-volume' }
  if (size === null) return { written: false, reason: 'output-missing' }
  const moved = withVirtualdjSongMoved(
    xml,
    song.path,
    { path: virtualdjStoredPath(root, pair.to, xml), size, bitrateKbps: bitrateKbps ?? null },
    0,
    null,
  )
  if (moved === null) return { written: false, reason: 'unwritable' }
  draft.write(file, moved)
  return { written: true, outcome: 'repointed' }
}

export async function replaceVirtualdjDuplicates(
  pairs: DuplicatePair[],
  deps: VirtualdjCommitDeps & { audioOf?: (path: string) => Promise<VirtualdjAudio> },
): Promise<DuplicateReplaceResult[]> {
  const all = (reason: string): DuplicateReplaceResult[] =>
    pairs.map(() => ({ written: false, reason }))
  const sizes = pairs.map((p) => sizeOf(p.to))
  const bitrates = await Promise.all(
    pairs.map(async (p) => (await deps.audioOf?.(p.to).catch(() => undefined))?.bitrateKbps),
  )
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const draft = createVirtualdjDraft()
    const roots = deps.roots()
    const listed = new Set(
      readVirtualdjLibrary(roots).lists.flatMap(function paths(n): string[] {
        return n.kind === 'playlist'
          ? n.paths.map(virtualdjPathKey)
          : (n.children ?? []).flatMap(paths)
      }),
    )
    const songs = pairs.map((p, i) => replacedSong(draft, p, roots, sizes[i], bitrates[i]))
    const written = await commitVirtualdjDraft(draft, deps)
    if (written === 'changed') continue
    if (written === 'cancelled') return all(RUNNING)
    if (written !== 'written' && written !== 'nothing') return all(written)
    const results = pairs.map((p, i): DuplicateReplaceResult => {
      const song = songs[i]
      if (song) return song
      if (listed.has(virtualdjPathKey(p.from)) && sizes[i] !== null)
        return { written: true, outcome: 'repointed' }
      return { written: false, reason: 'no-match' }
    })
    const moves = pairs.flatMap((p, i) => {
      const size = sizes[i]
      return results[i].written && size !== null ? [{ from: p.from, to: p.to, size }] : []
    })
    if (moves.length > 0) {
      const lists = await moveVirtualdjListRows(moves, deps)
      if (lists === 'cancelled') return all(RUNNING)
      if (lists !== 'written' && lists !== 'nothing') {
        log.warn(`VirtualDJ lists not moved to the kept copies: ${lists}`)
        return all('write-failed')
      }
    }
    return results
  }
  log.info('VirtualDJ database kept changing while Surco replaced duplicates, nothing written')
  return all(RUNNING)
}
