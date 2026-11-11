// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GridCheck } from '../../../shared/gridCheck'
import i18n from '../i18n'
import type { AutoMarkTarget } from '../lib/cueAutoMark'
import { startDraft } from '../lib/cueDraft'
import type { adjustGrids as AdjustGrids } from '../lib/cueGridBatch'
import {
  forgetDraft,
  type GridAdjust,
  keepDraft,
  keepGridAdjust,
  resetCueSession,
} from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { GridBatchBlock } from './GridBatchBlock'

const adjustGrids = vi.hoisted(() => vi.fn<typeof AdjustGrids>())
vi.mock('../lib/cueGridBatch', () => ({ adjustGrids }))

const ON_BEATS: GridCheck = { hereMs: 2, endMs: -3, worstMs: 3, verdict: null }
const LATE: GridCheck = { hereMs: 102, endMs: 101, worstMs: 102, verdict: null }

const TARGETS: AutoMarkTarget[] = [
  { contentId: '201', path: '/m/club.wav', label: 'Club Robbers' },
  { contentId: '202', path: '/m/maniac.wav', label: 'Maniac' },
  { contentId: '203', path: '/m/sky.wav', label: 'Summer Sky' },
]

const AFTER = startDraft([], 'mine', [], { bpm: 145, anchorMs: 0 }, 'g0')

beforeAll(() => i18n.changeLanguage('es'))

afterEach(() => {
  cleanup()
  resetCueSession()
  adjustGrids.mockReset()
})

function setup({
  checks = { '201': LATE, '202': ON_BEATS, '203': ON_BEATS },
  results = {},
  targets = TARGETS,
}: {
  checks?: Record<string, GridCheck | null | undefined>
  results?: Record<string, GridAdjust>
  targets?: AutoMarkTarget[]
} = {}) {
  adjustGrids.mockImplementation(async (_client, picked) => {
    for (const t of picked) {
      const result = results[t.contentId] ?? { kind: 'fine' }
      if (result.kind === 'adjusted')
        keepDraft(t.contentId, `k${t.contentId}`, result.after, { ...t, fingerprint: 'f0' })
      keepGridAdjust(t.contentId, result)
    }
  })
  const onShowInList = vi.fn()
  const onOpen = vi.fn()
  const client = new QueryClient()
  const tree = () => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueGridTolerance: 10 }}>
        <GridBatchBlock
          targets={targets}
          checkOf={(contentId) => checks[contentId]}
          onShowInList={onShowInList}
          onOpen={onOpen}
        />
      </SettingsProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(tree())
  return { onShowInList, onOpen, rerenderBlock: () => rerender(tree()) }
}

describe('Grid over several selected tracks', () => {
  it('offers to adjust only the tracks that need it', () => {
    setup()
    expect(screen.getByTestId('grid-batch-adjust')).toHaveTextContent('Ajustar 1 pista')
    expect(screen.getByTestId('grid-batch-summary')).toHaveTextContent(
      '1 de 3 no va con los golpes. 2 ya van con los golpes y no se tocan.',
    )
  })

  it('says every track already sits on the beats and offers nothing to adjust', () => {
    setup({ checks: { '201': ON_BEATS, '202': ON_BEATS, '203': ON_BEATS } })
    expect(screen.getByTestId('grid-batch-summary')).toHaveTextContent('Todas van con los golpes.')
    expect(screen.queryByTestId('grid-batch-adjust')).not.toBeInTheDocument()
  })

  it('waits while measuring so nobody adjusts half a playlist', () => {
    setup({ checks: { '201': LATE, '202': undefined, '203': ON_BEATS } })
    expect(screen.getByTestId('grid-batch-adjust')).toBeDisabled()
    expect(screen.getByTestId('grid-batch-measuring')).toHaveTextContent(
      'Midiendo la rejilla… 2 de 3',
    )
  })

  it('lists Club Robbers with the tempo Surco hears and the one rekordbox says', async () => {
    setup({
      results: {
        '201': { kind: 'review', reason: { kind: 'tempo', heardBpm: 137.9, programBpm: 145 } },
      },
    })
    fireEvent.click(screen.getByTestId('grid-batch-adjust'))
    const row = await screen.findByTestId('grid-batch-review-201')
    expect(row).toHaveTextContent('Club Robbers')
    expect(row).toHaveTextContent('Surco oye 137,9 BPM y rekordbox dice 145')
    expect(screen.getByTestId('grid-batch-tally')).toHaveTextContent('Para revisar a mano1')
    expect(screen.getByTestId('grid-batch-tally')).toHaveTextContent('Ya estaban bien2')
  })

  it('names the cue jump and the fit that does not help as the reasons', async () => {
    setup({
      checks: { '201': LATE, '202': LATE, '203': ON_BEATS },
      results: {
        '201': { kind: 'review', reason: { kind: 'cueJump', ms: -812.4 } },
        '202': { kind: 'review', reason: { kind: 'noBetter', beforeMs: 40, afterMs: 45 } },
      },
    })
    fireEvent.click(screen.getByTestId('grid-batch-adjust'))
    expect(await screen.findByTestId('grid-batch-review-201')).toHaveTextContent(
      'Un cue se movería 812 ms',
    )
    expect(screen.getByTestId('grid-batch-review-202')).toHaveTextContent('El ajuste no la mejora')
  })

  it('opens a set-aside track in the editor', async () => {
    const { onOpen } = setup({
      results: {
        '201': { kind: 'review', reason: { kind: 'noBetter', beforeMs: 40, afterMs: 45 } },
      },
    })
    fireEvent.click(screen.getByTestId('grid-batch-adjust'))
    fireEvent.click(await screen.findByTestId('grid-batch-open-201'))
    expect(onOpen).toHaveBeenCalledWith('201')
  })

  it('turns on the bad grid filter from the panel', () => {
    const { onShowInList } = setup()
    fireEvent.click(screen.getByTestId('grid-batch-show'))
    expect(onShowInList).toHaveBeenCalled()
  })

  it('offers to undo only while a selected track holds an adjustment', async () => {
    setup({ results: { '201': { kind: 'adjusted', before: null, after: AFTER } } })
    expect(screen.queryByTestId('grid-batch-undo')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('grid-batch-adjust'))
    fireEvent.click(await screen.findByTestId('grid-batch-undo'))
    await waitFor(() => expect(screen.queryByTestId('grid-batch-undo')).not.toBeInTheDocument())
    expect(screen.queryByTestId('grid-batch-tally')).not.toBeInTheDocument()
  })

  it('drops the undo once the adjusted draft is saved, since there is nothing left to give back', async () => {
    setup({ results: { '201': { kind: 'adjusted', before: null, after: AFTER } } })
    fireEvent.click(screen.getByTestId('grid-batch-adjust'))
    await screen.findByTestId('grid-batch-undo')
    act(() => forgetDraft('201'))
    expect(screen.queryByTestId('grid-batch-undo')).not.toBeInTheDocument()
  })

  it('drops the undo once every adjusted track was retouched in the editor, which undo leaves as it is', async () => {
    const { rerenderBlock } = setup({
      checks: { '201': LATE, '202': LATE, '203': ON_BEATS },
      results: {
        '201': { kind: 'adjusted', before: null, after: AFTER },
        '202': { kind: 'adjusted', before: null, after: AFTER },
      },
    })
    fireEvent.click(screen.getByTestId('grid-batch-adjust'))
    await screen.findByTestId('grid-batch-undo')
    const retouch = (contentId: string) =>
      keepDraft(contentId, `k${contentId}`, { ...AFTER }, { ...TARGETS[0], fingerprint: 'f0' })
    act(() => retouch('201'))
    rerenderBlock()
    expect(screen.getByTestId('grid-batch-undo')).toBeInTheDocument()
    act(() => retouch('202'))
    rerenderBlock()
    expect(screen.queryByTestId('grid-batch-undo')).not.toBeInTheDocument()
  })

  it('counts the tracks with no beats to measure apart from the ones already fine', () => {
    setup({ checks: { '201': LATE, '202': null, '203': ON_BEATS } })
    expect(screen.getByTestId('grid-batch-summary')).toHaveTextContent(
      '1 de 3 no va con los golpes. 1 ya va con los golpes y no se toca.',
    )
    expect(screen.getByTestId('grid-batch-unmeasurable')).toHaveTextContent(
      '1 sin golpes que medir',
    )
  })

  it('never says every grid sits on the beats when some could not be measured', () => {
    setup({ checks: { '201': ON_BEATS, '202': null, '203': ON_BEATS } })
    expect(screen.getByTestId('grid-batch-summary')).not.toHaveTextContent(
      'Todas van con los golpes.',
    )
    expect(screen.getByTestId('grid-batch-unmeasurable')).toHaveTextContent(
      '1 sin golpes que medir',
    )
    expect(screen.queryByTestId('grid-batch-adjust')).not.toBeInTheDocument()
  })

  it('says on its own that the measured tracks are fine when others cannot be measured', () => {
    setup({ checks: { '201': ON_BEATS, '202': null, '203': ON_BEATS } })
    expect(screen.getByTestId('grid-batch-summary')).toHaveTextContent(
      '2 ya van con los golpes y no se tocan.',
    )
    expect(screen.getByTestId('grid-batch-summary')).not.toHaveTextContent('Todas')
    expect(screen.getByTestId('grid-batch-unmeasurable')).toHaveTextContent(
      '1 sin golpes que medir',
    )
  })

  it('shows only the unmeasurable line when no track could be measured', () => {
    setup({ checks: { '201': null, '202': null, '203': null } })
    expect(screen.queryByTestId('grid-batch-summary')).not.toBeInTheDocument()
    expect(screen.getByTestId('grid-batch-unmeasurable')).toHaveTextContent(
      '3 sin golpes que medir',
    )
  })

  it('tells apart the tracks to adjust, the fine ones and the unmeasurable ones', () => {
    setup({ checks: { '201': LATE, '202': null, '203': ON_BEATS } })
    expect(screen.getByTestId('grid-batch-summary')).toHaveTextContent(
      '1 de 3 no va con los golpes. 1 ya va con los golpes y no se toca.',
    )
    expect(screen.getByTestId('grid-batch-unmeasurable')).toHaveTextContent(
      '1 sin golpes que medir',
    )
  })

  it('stays out of a selection whose grids all come from Serato', () => {
    setup({
      targets: [{ contentId: 'serato:/m/a.mp3', path: '/m/a.mp3', label: 'A' }],
      checks: { 'serato:/m/a.mp3': null },
    })
    expect(screen.queryByTestId('grid-batch')).not.toBeInTheDocument()
  })
})
