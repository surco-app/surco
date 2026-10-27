// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { LibraryTracks, TrackCues } from '../../../shared/types'
import i18n from '../i18n'
import { startDraft } from '../lib/cueDraft'
import {
  autoMarkOf,
  cueDraftKey,
  keepAutoMark,
  keepDraft,
  resetCueSession,
  unsavedCueTracks,
} from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesBatchSection } from './CuesBatchSection'

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32]
const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [{ ms: bar(56), kind: 'up' }],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}
const TARGETS = [
  { contentId: '103', path: '/m/a.wav', label: 'Maniac' },
  { contentId: '104', path: '/m/b.wav', label: 'Summer Sky' },
]

afterEach(() => {
  cleanup()
  resetCueSession()
})

function setup(twins: Record<string, LibraryTracks> = {}) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => 'queued')
  installApi({
    rekordboxCueTwins: vi.fn<Api['rekordboxCueTwins']>(async (file) => twins[file] ?? {}),
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) => ({
      ...READ,
      contentId: id,
    })),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    saveRekordboxCues,
  })
  const onMark = vi.fn()
  const onFlow = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
        <CuesBatchSection targets={TARGETS} onMark={onMark} onFlow={onFlow} />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { saveRekordboxCues, onMark, onFlow }
}

describe('Cues over several selected tracks', () => {
  // With thirteen tracks selected the DJ wants them marked the way one track is: with the
  // flow they pick, not whichever happened to be active, and saying how many it will touch.
  it('lets the flow be picked before marking the whole selection', () => {
    const { onMark, onFlow } = setup()
    fireEvent.click(screen.getByTestId('cues-batch-flow'))
    fireEvent.click(
      screen.getByRole('option', { name: i18n.t(`cueFlows.builtIn.${ONE_AT_32.id}`) }),
    )
    expect(onFlow).toHaveBeenCalledWith(ONE_AT_32.id)
    const mark = screen.getByTestId('cues-auto-mark-all')
    expect(mark).toHaveTextContent(i18n.t('editor.cues.batch.mark', { count: 2 }))
    fireEvent.click(mark)
    expect(onMark).toHaveBeenCalledTimes(1)
  })

  // Going through the tracks one by one to accept was the chore: one click accepts every
  // proposal, as cues waiting to be saved, so any of them can still be opened and adjusted.
  it('accepts every proposal of the selection at once and leaves the cues unsaved', async () => {
    const { saveRekordboxCues } = setup()
    act(() => {
      keepAutoMark('103', { kind: 'proposed', ms: [bar(64), bar(128)] })
      keepAutoMark('104', { kind: 'proposed', ms: [bar(32)] })
    })
    expect(screen.getByTestId('cues-batch-tally')).toHaveTextContent('2')
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await waitFor(() => expect([...unsavedCueTracks()].sort()).toEqual(['103', '104']))
    expect(autoMarkOf('103')).toBeUndefined()
    expect(saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('names the accept button by the proposals it accepts', () => {
    setup()
    act(() => {
      keepAutoMark('103', { kind: 'proposed', ms: [bar(64), bar(128)] })
      keepAutoMark('104', { kind: 'proposed', ms: [bar(32)] })
    })
    expect(screen.getByTestId('cues-batch-accept')).toHaveTextContent(
      i18n.t('editor.cues.auto.accept', { count: 3 }),
    )
  })

  it('counts the tracks with nothing to accept apart, so the DJ knows which ones need a look', () => {
    setup()
    act(() => {
      keepAutoMark('103', { kind: 'marked' })
      keepAutoMark('104', { kind: 'unanalysed' })
    })
    const tally = screen.getByTestId('cues-batch-tally')
    expect(tally).toHaveTextContent(i18n.t('trackList.autoMark.marked'))
    expect(tally).toHaveTextContent(i18n.t('trackList.autoMark.unanalysed'))
    expect(screen.queryByTestId('cues-batch-accept')).toBeNull()
  })

  it('throws the proposals away on Descartar without placing anything', () => {
    setup()
    act(() => keepAutoMark('103', { kind: 'proposed', ms: [bar(64)] }))
    fireEvent.click(screen.getByTestId('cues-batch-discard'))
    expect(autoMarkOf('103')).toBeUndefined()
    expect([...unsavedCueTracks()]).toEqual([])
  })

  // Saving from here writes the selection's cues and nothing else: an unsaved draft on a
  // track the DJ did not select is theirs to save from that track.
  it('saves the unsaved cues of the selected tracks only', async () => {
    const { saveRekordboxCues } = setup()
    const draft = (id: string) =>
      keepDraft(
        id,
        cueDraftKey(id, 'f0', null),
        startDraft([{ ms: bar(64), kind: 0, color: null }], 'mine'),
        {
          path: `/m/${id}.wav`,
          label: id,
          fingerprint: 'f0',
        },
      )
    act(() => {
      draft('103')
      draft('999')
    })
    const save = screen.getByTestId('cues-batch-save')
    expect(save).toHaveTextContent(i18n.t('editor.cues.saveAll', { count: 1 }))
    fireEvent.click(save)
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual(['103'])
    await waitFor(() => expect([...unsavedCueTracks()]).toEqual(['999']))
  })

  // Marking thirteen tracks from rekordbox's list reaches Traktor and Engine DJ too, so the
  // DJ sees beforehand how many tracks each program gets and saves them all at once.
  it('counts what each program gets and saves the flow in all of them', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    const T2 = 'traktor:M/:m/:b.wav'
    const { saveRekordboxCues } = setup({
      '/m/a.wav': { traktor: T1 },
      '/m/b.wav': { traktor: T2, engine: 'engine:2' },
    })
    act(() => {
      keepAutoMark('103', { kind: 'proposed', ms: [bar(64)] })
      keepAutoMark('104', { kind: 'proposed', ms: [bar(96)] })
    })
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    const twins = await screen.findByTestId('cues-batch-twins')
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-twin-traktor')).toHaveTextContent('2'),
    )
    expect(screen.getByTestId('cues-batch-twin-rekordbox')).toHaveTextContent('2')
    expect(screen.getByTestId('cues-batch-twin-engine')).toHaveTextContent('1')
    expect(twins).toHaveTextContent('Engine DJ')
    const save = screen.getByTestId('cues-batch-save')
    expect(save).toHaveTextContent(i18n.t('editor.cues.saveAllMixed', { count: 2 }))
    fireEvent.click(save)
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId).sort()).toEqual(
      ['103', '104', 'engine:2', T1, T2].sort(),
    )
  })

  it('says how many tracks keep their unsaved changes in the other program', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    keepDraft(
      T1,
      cueDraftKey(T1, 'f0', null),
      startDraft([{ ms: bar(8), kind: 1, color: 1 }], 'mine'),
      {
        path: '/m/a.wav',
        label: 'Maniac',
        fingerprint: 'f0',
      },
    )
    const { saveRekordboxCues } = setup({ '/m/a.wav': { traktor: T1 } })
    act(() => keepAutoMark('103', { kind: 'proposed', ms: [bar(64)] }))
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    const traktor = await screen.findByTestId('cues-batch-twin-traktor')
    expect(traktor).toHaveTextContent(i18n.t('editor.cues.batch.twinsUnsaved', { count: 1 }))
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual(['103'])
  })
})
