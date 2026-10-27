// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { MY_FLOW } from '../../../shared/cueFlows'
import { ALL_SLOTS } from '../../../shared/cueRules'
import type { LibraryTracks, Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { reduceDraft, startDraft } from '../lib/cueDraft'
import { cueDraftKey, keepDraft, resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
afterEach(resetEditorSections)

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}
const TRAKTOR = 'traktor:M/:Music/:g.wav'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 80,
    right: 400,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(
  settings: Partial<Settings> = {},
  twins: Record<string, LibraryTracks> = { '/m/g.wav': { traktor: TRAKTOR } },
) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
  const rekordboxCueTwins = vi.fn<Api['rekordboxCueTwins']>(async (file) => twins[file] ?? {})
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) => ({
      ...READ,
      contentId: id,
    })),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueTwins,
    saveRekordboxCues,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: [MY_FLOW], activeCueFlow: 'mine', ...settings }}>
        <CuesSection
          cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
          open
          onToggle={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { saveRekordboxCues, rekordboxCueTwins }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const markAt = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
  fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
}
const savedIds = (save: ReturnType<typeof setup>['saveRekordboxCues']) =>
  save.mock.calls[0][0].map((r) => r.contentId)

describe('a flow placed in the cue editor reaches the other DJ programs', () => {
  // The DJ marks a break once in rekordbox and the same file in Traktor gets the flow too,
  // in the one save, so there is no second program to open and mark by hand.
  it('says what the flow will put in the other program and saves it there with the track', async () => {
    const { saveRekordboxCues } = setup()
    await ready()
    markAt(bar(64))
    const row = await screen.findByTestId('cues-twin-traktor')
    expect(row).toHaveTextContent('Traktor')
    expect(row).toHaveTextContent('3')
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(savedIds(saveRekordboxCues)).toEqual(['103', TRAKTOR])
    const traktor = saveRekordboxCues.mock.calls[0][0][1]
    expect(traktor).toMatchObject({ path: '/m/g.wav', label: 'Gowan', fingerprint: 'f0' })
    expect(traktor.wanted.filter((c) => c.kind !== 0)).toHaveLength(3)
  })

  it('shows and saves nothing elsewhere until a break is marked with the flow', async () => {
    const { rekordboxCueTwins } = setup()
    await ready()
    expect(screen.queryByTestId('cues-twins')).toBeNull()
    expect(rekordboxCueTwins).not.toHaveBeenCalled()
  })

  it('keeps the flow in this program when the DJ took the other out of the flows', async () => {
    const { saveRekordboxCues } = setup({ cueFlowToTraktor: false })
    await ready()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(savedIds(saveRekordboxCues)).toEqual(['103'])
    expect(screen.queryByTestId('cues-twins')).toBeNull()
  })

  it('leaves the other program’s unsaved changes alone unless the DJ chooses to lose them', async () => {
    keepDraft(TRAKTOR, 'k', startDraft([{ ms: bar(8), kind: 1, color: 1 }], 'mine'), {
      path: '/m/g.wav',
      label: 'Gowan',
      fingerprint: 'f0',
    })
    const { saveRekordboxCues } = setup()
    await ready()
    markAt(bar(64))
    expect(await screen.findByTestId('cues-twin-traktor-unsaved')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-twin-traktor-overwrite'))
    await screen.findByTestId('cues-twin-traktor')
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(savedIds(saveRekordboxCues)).toEqual(['103', TRAKTOR])
    expect(saveRekordboxCues.mock.calls[0][0][1].wanted).not.toContainEqual(
      expect.objectContaining({ ms: bar(8) }),
    )
  })

  it('saves only this track while the other program’s changes are kept', async () => {
    keepDraft(TRAKTOR, 'k', startDraft([{ ms: bar(8), kind: 1, color: 1 }], 'mine'), {
      path: '/m/g.wav',
      label: 'Gowan',
      fingerprint: 'f0',
    })
    const { saveRekordboxCues } = setup()
    await ready()
    markAt(bar(64))
    await screen.findByTestId('cues-twin-traktor-unsaved')
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(savedIds(saveRekordboxCues)).toEqual(['103'])
  })
  it('places each track’s flow in the other programs when every unsaved track is saved', async () => {
    const other = reduceDraft(
      startDraft([], 'mine'),
      { type: 'mark-drop', ms: bar(96) },
      {
        beats: GRID.map((b) => b.ms),
        snapTo: GRID.map((b) => b.ms),
        strong: [],
        phrases: [],
        flows: [MY_FLOW],
        slots: ALL_SLOTS,
      },
    )
    keepDraft('104', cueDraftKey('104', 'f0', null), other, {
      path: '/m/h.wav',
      label: 'Hold',
      fingerprint: 'f0',
    })
    const { saveRekordboxCues } = setup(
      {},
      { '/m/g.wav': { traktor: TRAKTOR }, '/m/h.wav': { traktor: 'traktor:M/:Music/:h.wav' } },
    )
    await ready()
    markAt(bar(64))
    await screen.findByTestId('cues-twin-traktor')
    fireEvent.click(screen.getByTestId('cues-save-all'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(savedIds(saveRekordboxCues).sort()).toEqual(
      ['103', '104', TRAKTOR, 'traktor:M/:Music/:h.wav'].sort(),
    )
  })
})
