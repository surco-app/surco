// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { HOT_KINDS } from '../../../shared/cueRules'
import {
  type EditableGrid,
  editableGridOf,
  type GridFit,
  gridBeats,
} from '../../../shared/gridEdit'
import type { TrackCues } from '../../../shared/types'
import { installApi, testSettings } from '../test/api'
import { startDraft } from './cueDraft'
import { adjustGrids } from './cueGridBatch'
import {
  cueDraftKey,
  gridAdjusts,
  keepDraft,
  keptDrafts,
  resetCueSession,
  undoGridAdjusts,
  unsavedCueTracks,
} from './cueSession'

const BPM = 145
const DURATION_MS = 300000
const ON_KICKS: GridFit = { bpm: BPM, firstMs: 0 }
const BEAT_INDEXES = [50, 300, 600]

const readOn = (contentId: string, grid: EditableGrid): TrackCues => {
  const beats = gridBeats(grid, DURATION_MS)
  return {
    contentId,
    analysed: true,
    grid: beats,
    strong: [],
    phrases: [],
    cues: BEAT_INDEXES.map((i, n) => ({
      id: `${contentId}-c${n}`,
      ms: beats[i].ms,
      kind: HOT_KINDS[n],
      color: null,
      loop: false,
    })),
    wave: null,
    durationMs: DURATION_MS,
    fingerprint: 'f0',
    gridFingerprint: 'g0',
  }
}

const LATE = { bpm: BPM, anchorMs: 102 }
const ON_TIME = { bpm: BPM, anchorMs: 4 }
const CLUB_ROBBERS = {
  bpm: BPM,
  anchorMs: 0,
  zones: [
    { fromMs: 100000, bpm: BPM, anchorMs: 100300 },
    { fromMs: 200000, bpm: BPM, anchorMs: 200600 },
  ],
}

const settings = {
  cueGridTolerance: testSettings.cueGridTolerance,
  cueFlows: testSettings.cueFlows,
  activeCueFlow: testSettings.activeCueFlow,
  cueQuantize: testSettings.cueQuantize,
  cueLettersByTime: testSettings.cueLettersByTime,
}

const targetOf = (contentId: string) => ({
  contentId,
  path: `/m/${contentId}.mp3`,
  label: contentId,
})

afterEach(resetCueSession)

function setup({
  reads,
  fits = {},
}: {
  reads: Record<string, TrackCues>
  fits?: Record<string, GridFit | null | Error>
}) {
  installApi({
    cues: {
      trackCues: vi.fn<Api['cues']['trackCues']>(async (id) => reads[id] ?? null),
      queued: vi.fn<Api['cues']['queued']>(async () => null),
      gridFit: vi.fn<Api['cues']['gridFit']>(async (id) => {
        const fit = id in fits ? fits[id] : ON_KICKS
        if (fit instanceof Error) throw fit
        return fit
      }),
    },
  })
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const draftOf = (contentId: string) => keptDrafts().find((d) => d.contentId === contentId)?.draft

const keepHandDraft = (read: TrackCues, movedMs: number) => {
  const cues = read.cues.map(({ id, ms, kind, color }, n) => ({
    id,
    ms: n === 0 ? movedMs : ms,
    kind,
    color,
  }))
  const grid = editableGridOf(read.grid)
  const draft = startDraft(cues, settings.activeCueFlow, [], grid, read.gridFingerprint)
  keepDraft(read.contentId, cueDraftKey(read.contentId, read.fingerprint, null), draft, {
    path: `/m/${read.contentId}.mp3`,
    label: read.contentId,
    fingerprint: read.fingerprint,
  })
  return draft
}

describe('Ajustar rejilla over several tracks', () => {
  it('adjusts only the tracks that need it and leaves the rest without a draft', async () => {
    const client = setup({
      reads: {
        '201': readOn('201', LATE),
        '202': readOn('202', ON_TIME),
        '203': readOn('203', CLUB_ROBBERS),
      },
      fits: { '203': { bpm: 137.9, firstMs: 0 } },
    })
    await adjustGrids(client, ['201', '202', '203'].map(targetOf), settings)
    expect(gridAdjusts().get('201')?.kind).toBe('adjusted')
    expect(gridAdjusts().get('202')).toEqual({ kind: 'fine' })
    expect(gridAdjusts().get('203')).toEqual({
      kind: 'review',
      reason: { kind: 'tempo', heardBpm: 137.9, programBpm: BPM },
    })
    expect([...unsavedCueTracks()]).toEqual(['201'])
    const adjusted = draftOf('201')
    expect(adjusted?.grid?.anchorMs).not.toBeCloseTo(102, 0)
  })

  it('counts an already adjusted track as fine on a second run instead of touching it again', async () => {
    const client = setup({ reads: { '201': readOn('201', LATE) } })
    await adjustGrids(client, [targetOf('201')], settings)
    const first = draftOf('201')
    await adjustGrids(client, [targetOf('201')], settings)
    expect(gridAdjusts().get('201')).toEqual({ kind: 'fine' })
    expect(draftOf('201')).toBe(first)
  })

  it('measures a Serato or unanalysed track as unmeasured without failing the batch', async () => {
    const client = setup({
      reads: {
        'serato:/a.mp3': readOn('serato:/a.mp3', LATE),
        '204': { ...readOn('204', LATE), analysed: false },
        '205': readOn('205', LATE),
        '206': readOn('206', LATE),
        '201': readOn('201', LATE),
      },
      fits: { '205': null, '206': new Error('no audio') },
    })
    await adjustGrids(client, ['serato:/a.mp3', '204', '205', '206', '201'].map(targetOf), settings)
    for (const id of ['serato:/a.mp3', '204', '205', '206'])
      expect(gridAdjusts().get(id)).toEqual({ kind: 'unmeasured' })
    expect(gridAdjusts().get('201')?.kind).toBe('adjusted')
    expect([...unsavedCueTracks()]).toEqual(['201'])
  })

  it('sets aside a track whose draft sits on Surco’s grid with the editor’s reason', async () => {
    const read = readOn('201', LATE)
    const client = setup({ reads: { '201': read } })
    keepDraft(
      '201',
      cueDraftKey('201', 'f0', null),
      startDraft([], settings.activeCueFlow, [], editableGridOf(read.grid)),
      {
        path: '/m/201.mp3',
        label: '201',
        fingerprint: 'f0',
        provisional: true,
      },
    )
    await adjustGrids(client, [targetOf('201')], settings)
    expect(gridAdjusts().get('201')).toEqual({
      kind: 'review',
      reason: { kind: 'gate', key: 'editor.cues.grid.surcoDraft' },
    })
  })

  it('adjusts on top of an unsaved draft, as Auto marcar does', async () => {
    const read = readOn('201', LATE)
    const client = setup({ reads: { '201': read } })
    const movedMs = read.grid[48].ms
    const hand = keepHandDraft(read, movedMs)
    await adjustGrids(client, [targetOf('201')], settings)
    const adjust = gridAdjusts().get('201')
    expect(adjust?.kind === 'adjusted' && adjust.before).toBe(hand)
    const adjusted = draftOf('201')
    const moved = adjusted?.cues.find((c) => c.id === '201-c0')
    expect((moved?.ms ?? 0) - movedMs).toBeCloseTo(-102, 0)
    expect(adjusted?.grid).not.toEqual(hand.grid)
    undoGridAdjusts(['201'])
    expect(draftOf('201')).toBe(hand)
  })

  it('undoes every adjusted track except one retouched in the editor', async () => {
    const client = setup({ reads: { '201': readOn('201', LATE), '207': readOn('207', LATE) } })
    await adjustGrids(client, [targetOf('201'), targetOf('207')], settings)
    const after = draftOf('207')
    const retouched = { ...(after as NonNullable<typeof after>), selected: null }
    keepDraft('207', cueDraftKey('207', 'f0', null), retouched, {
      path: '/m/207.mp3',
      label: '207',
      fingerprint: 'f0',
    })
    undoGridAdjusts(['201', '207'])
    expect([...unsavedCueTracks()]).toEqual(['207'])
    expect(draftOf('207')).toBe(retouched)
    expect(gridAdjusts().size).toBe(0)
  })
})
