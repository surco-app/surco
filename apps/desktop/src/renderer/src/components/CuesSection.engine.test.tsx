// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { SaveCuesOutcome, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { startDraft } from '../lib/cueDraft'
import { keepDraft, resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
afterEach(resetEditorSections)

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]
const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const READ: TrackCues = {
  contentId: 'engine:4',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}

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
  read: TrackCues | null | Error = READ,
  saved: SaveCuesOutcome = 'queued',
  contentId = 'engine:4',
) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => saved)
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => {
      if (read instanceof Error) throw read
      return read
    }),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    saveRekordboxCues,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
        <CuesSection
          cue={{ contentId, path: '/m/e.wav', label: 'Tengo' }}
          open
          onToggle={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { saveRekordboxCues }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const markAt = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
  fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
}

describe('CuesSection on an Engine DJ track', () => {
  it('saves to Engine DJ, not rekordbox', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-save')).toHaveAccessibleName('Save to Engine DJ')
  })

  it('explains that Auto marcar does not work on Engine tracks yet instead of blaming a missing rekordbox analysis', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-auto-mark')).toBeDisabled()
    expect(screen.getByTestId('cues-auto-mark')).toHaveAttribute(
      'title',
      'Auto mark does not work with Engine DJ tracks yet',
    )
  })

  it('says Engine DJ has not analysed the track, and offers nothing to save', async () => {
    setup({ ...READ, analysed: false, grid: [] })
    await waitFor(() =>
      expect(screen.getByTestId('cues-unanalysed')).toHaveTextContent(
        'Engine DJ has not analysed this track yet',
      ),
    )
    expect(screen.queryByTestId('cues-save')).toBeNull()
  })

  it('says it could not read Engine DJ when the read fails', async () => {
    setup(new Error('boom'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-unreadable')).toHaveTextContent(
        'Could not read the cues from Engine DJ',
      ),
    )
  })

  it('warns while the draft holds CALLs that Engine DJ will not keep them, before the DJ saves', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-engine-calls')).toBeNull()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument())
    expect(screen.getByTestId('cues-engine-calls')).toHaveTextContent(
      'Engine DJ only keeps hot cues. The CALLs will not be saved',
    )
  })

  it('never warns about CALLs on a rekordbox track, which keeps them', async () => {
    setup({ ...READ, contentId: '103' }, 'queued', '103')
    await ready()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument())
    expect(screen.queryByTestId('cues-engine-calls')).toBeNull()
  })

  it('says the save belongs to another Engine library when its queue holds one', async () => {
    setup(READ, 'other-collection')
    await ready()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-save-failed')).toHaveTextContent(
        'What is waiting belongs to another Engine DJ library',
      ),
    )
  })

  it('names both apps on Save all when the unsaved tracks are in rekordbox and in Engine DJ', async () => {
    setup()
    await ready()
    const target = { path: '/m/x.wav', label: 'x', fingerprint: 'f0' }
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), target)
    keepDraft('engine:9', 'engine:9|f0|null', startDraft([], 'mine'), target)
    await waitFor(() =>
      expect(screen.getByTestId('cues-save-all')).toHaveTextContent(
        'Save 2 tracks to rekordbox and Engine DJ',
      ),
    )
  })

  it('says Save all to Engine DJ when every unsaved track is Engine’s', async () => {
    setup()
    await ready()
    const target = { path: '/m/x.wav', label: 'x', fingerprint: 'f0' }
    keepDraft('engine:8', 'engine:8|f0|null', startDraft([], 'mine'), target)
    keepDraft('engine:9', 'engine:9|f0|null', startDraft([], 'mine'), target)
    await waitFor(() =>
      expect(screen.getByTestId('cues-save-all')).toHaveTextContent('Save 2 tracks to Engine DJ'),
    )
  })
})
