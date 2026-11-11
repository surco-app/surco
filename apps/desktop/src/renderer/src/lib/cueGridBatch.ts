import type { QueryClient } from '@tanstack/react-query'
import { programOf } from '../../../shared/djProgram'
import { editableGridOf, gridBeats } from '../../../shared/gridEdit'
import { gridFitQuery, queuedCuesQuery, trackCuesQuery } from '../hooks/useTrackCues'
import { appliedGrid } from './appliedGrid'
import type { AutoMarkSettings, AutoMarkTarget } from './cueAutoMark'
import { startDraft } from './cueDraft'
import { cueProgramOf } from './cuePrograms'
import {
  cueDraftKey,
  type GridAdjust,
  keepDraft,
  keepGridAdjust,
  keptOnSurcoGrid,
} from './cueSession'
import { quantizePoints } from './cueWave'
import { adjustGrid } from './gridAdjust'
import { gridGate } from './gridGate'

export type GridBatchSettings = AutoMarkSettings & { cueGridTolerance: number }

async function adjustOne(
  client: QueryClient,
  target: AutoMarkTarget,
  settings: GridBatchSettings,
): Promise<GridAdjust> {
  const { contentId } = target
  const read = await client.fetchQuery(trackCuesQuery(contentId)).catch(() => null)
  if (!read?.analysed || cueProgramOf(contentId).fixedGrid) return { kind: 'unmeasured' }
  const fit = await client.fetchQuery(gridFitQuery(contentId)).catch(() => null)
  if (!fit) return { kind: 'unmeasured' }
  const queued = await client.fetchQuery(queuedCuesQuery(contentId))
  const programGrid = editableGridOf(read.grid)
  const applied = appliedGrid(contentId, read, queued, programGrid)
  const fresh = queued !== null && applied.fresh
  const baseline = fresh
    ? queued.wanted
    : read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
  const before = applied.kept ?? null
  const draft =
    before ??
    startDraft(
      baseline,
      settings.activeCueFlow,
      read.cues.filter((c) => c.loop).map((c) => c.id),
      applied.grid,
      applied.gridFingerprint,
      programGrid,
    )
  const key = gridGate({
    contentId,
    read,
    grid: draft.grid,
    onSurcoGrid: keptOnSurcoGrid(contentId),
  })
  if (key !== null) return { kind: 'review', reason: { kind: 'gate', key } }
  if (draft.grid === null) return { kind: 'unmeasured' }
  const gridded = { ...draft, grid: draft.grid }
  const grid = applied.changed ? gridBeats(gridded.grid, read.durationMs) : read.grid
  const result = adjustGrid({
    draft: gridded,
    beats: grid.map((b) => b.ms),
    ctx: {
      beats: grid.map((b) => b.ms),
      snapTo: quantizePoints(grid, settings.cueQuantize),
      strong: read.strong,
      phrases: read.phrases,
      flows: settings.cueFlows,
      lettersByTime: settings.cueLettersByTime,
      slots: cueProgramOf(contentId).slots,
    },
    fit,
    kicks: read.grid.map((b) => b.ms),
    durationMs: read.durationMs,
    toleranceMs: settings.cueGridTolerance,
    zones: programOf(contentId) === 'rekordbox',
  })
  if (result.kind !== 'adjusted') return result
  keepDraft(
    contentId,
    cueDraftKey(contentId, read.fingerprint, queued),
    result.draft,
    { path: target.path, label: target.label, fingerprint: read.fingerprint },
    fresh ? queued : null,
  )
  return { kind: 'adjusted', before, after: result.draft }
}

export async function adjustGrids(
  client: QueryClient,
  targets: AutoMarkTarget[],
  settings: GridBatchSettings,
): Promise<void> {
  for (const [i, target] of targets.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 0))
    keepGridAdjust(target.contentId, await adjustOne(client, target, settings))
  }
}
