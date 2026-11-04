// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import {
  DROP_MODEL,
  type DropInput,
  type DropModel,
  type DropProposal,
} from '../../../shared/dropDetect'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { TRAKTOR_CUE_COLOR } from '../../../shared/traktorContent'
import type { TrackCues } from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import i18n from '../i18n'
import { startDraft } from '../lib/cueDraft'
import { autoMarkOf, keepDraft, resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { saveAllItem } from '../test/cueSaveAll'
import { CuesSection } from './CuesSection'

const dropProposals = vi.hoisted(() =>
  vi.fn<(input: DropInput, model?: DropModel) => DropProposal[]>(),
)
vi.mock('../../../shared/dropDetect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/dropDetect')>()),
  dropProposals,
}))

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
  gridFingerprint: '',
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
  contentId = 'engine:4',
  dropInput: Api['rekordboxCueDropInput'] = async () => null,
  over: Partial<Api> = {},
  traktorNmlPath = '',
  path = '/m/e.wav',
) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => {
      if (read instanceof Error) throw read
      return read
    }),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueDropInput: vi.fn(dropInput),
    saveRekordboxCues,
    ...over,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', traktorNmlPath }}>
        <CuesSection cue={{ contentId, path, label: 'Tengo' }} open onToggle={vi.fn()} />
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

  it('reads nothing for Auto marcar until the DJ asks, so opening an Engine track never decodes it', async () => {
    const dropInput = vi.fn<Api['rekordboxCueDropInput']>(async () => null)
    setup(READ, 'engine:4', dropInput)
    await ready()
    expect(screen.getByTestId('cues-auto-mark')).toBeEnabled()
    expect(dropInput).not.toHaveBeenCalled()
  })

  it('proposes on Engine’s own beats, where the cues get saved, from what main gives it to detect on', async () => {
    const input: DropInput = {
      grid: GRID.map((b) => ({ ms: b.ms - 30, beat: b.beat })),
      phrases: [{ ms: bar(56) - 30, kind: 'up' }],
      words: new Uint16Array(3000),
    }
    dropProposals.mockReset().mockReturnValue([{ ms: bar(64) - 30, sure: true, quietBars: 8 }])
    setup(READ, 'engine:4', async () => input)
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    await waitFor(() =>
      expect(autoMarkOf('engine:4')).toEqual({
        kind: 'proposed',
        proposals: [{ ms: bar(64), sure: true, quietBars: 8 }],
      }),
    )
    expect(dropProposals).toHaveBeenCalledWith(input, DROP_MODEL)
  })

  it('says it is reading the track while the audio is decoded, since that can take a few seconds', async () => {
    let answer: (input: DropInput | null) => void = () => {}
    setup(READ, 'engine:4', () => new Promise((done) => (answer = done)))
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    await waitFor(() => expect(screen.getByTestId('cues-auto-mark')).toBeDisabled())
    expect(screen.getByTestId('cues-auto-mark')).toHaveTextContent('Reading the track…')
    answer(null)
    await waitFor(() => expect(screen.getByTestId('cues-auto-mark')).toBeEnabled())
  })

  it('says Surco could not read the audio when there is nothing to detect on, rather than proposing nothing as if it had looked', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-auto-unreadable')).toHaveTextContent(
        'Surco could not read the audio of this track',
      ),
    )
    expect(autoMarkOf('engine:4')).toEqual({ kind: 'unanalysed' })
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
    setup({ ...READ, contentId: '103' }, '103')
    await ready()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument())
    expect(screen.queryByTestId('cues-engine-calls')).toBeNull()
  })

  it('names both apps on Save all when the unsaved tracks are in rekordbox and in Engine DJ', async () => {
    setup()
    await ready()
    const target = { path: '/m/x.wav', label: 'x', fingerprint: 'f0' }
    keepDraft('103', '103|f0|null', startDraft([], 'mine'), target)
    keepDraft('engine:9', 'engine:9|f0|null', startDraft([], 'mine'), target)
    expect(await saveAllItem()).toHaveTextContent('Save 2 tracks to rekordbox and Engine DJ')
  })

  it('says Save all to Engine DJ when every unsaved track is Engine’s', async () => {
    setup()
    await ready()
    const target = { path: '/m/x.wav', label: 'x', fingerprint: 'f0' }
    keepDraft('engine:8', 'engine:8|f0|null', startDraft([], 'mine'), target)
    keepDraft('engine:9', 'engine:9|f0|null', startDraft([], 'mine'), target)
    expect(await saveAllItem()).toHaveTextContent('Save 2 tracks to Engine DJ')
  })
  it('keeps the CALL note to Engine DJ’s own, never Traktor’s, while the draft holds CALLs', async () => {
    setup()
    await ready()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId('cues-engine-calls')).toBeInTheDocument())
    expect(screen.queryByTestId('cues-traktor-calls')).toBeNull()
  })

  it('says nothing about CALLs on a rekordbox track, neither Engine’s note nor Traktor’s', async () => {
    setup({ ...READ, contentId: '103' }, '103')
    await ready()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument())
    expect(screen.queryByTestId('cues-traktor-calls')).toBeNull()
    expect(screen.queryByTestId('cues-engine-calls')).toBeNull()
  })

  it('offers a colour for an Engine DJ hot cue, from its button and its marker', async () => {
    setup()
    await ready()
    markAt(bar(64))
    const hot = await screen.findAllByTestId(/^cue-wave-hot-/)
    const traktorBlue = (() => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = hotCueColor(TRAKTOR_CUE_COLOR)
      return probe.style.backgroundColor
    })()
    expect(hot[0].style.backgroundColor).not.toBe(traktorBlue)
    fireEvent.click(hot[0])
    await waitFor(() => expect(screen.getByTestId('cues-colour')).toBeInTheDocument())
    fireEvent.contextMenu(hot[0])
    expect(screen.getByTestId('cues-menu-colour')).toBeInTheDocument()
    const help = screen.getByTestId('section-help')
    expect(help).toHaveTextContent(i18n.t('editor.cues.help'))
    expect(help).not.toHaveTextContent(i18n.t('editor.cues.traktor.colours'))
  })

  it('opens the colour palette on an Engine DJ pad when maximized', async () => {
    setup({ ...READ, cues: [{ id: 'h1', ms: bar(10), kind: 1, color: 1 }] })
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
    )
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cues-pad-colours')).toBeInTheDocument()
  })

  it('never holds an Engine DJ track back on the Traktor collection', async () => {
    const traktorCollectionInUse = vi.fn<Api['traktorCollectionInUse']>(async () => '/x.nml')
    setup(
      READ,
      'engine:4',
      async () => null,
      { traktorCanSave: async () => false, traktorCollectionInUse },
      '/Users/dj/collection.nml',
    )
    await ready()
    expect(screen.getByTestId('cues-auto-mark')).toBeEnabled()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    expect(screen.queryByTestId('cues-traktor-no-collection')).toBeNull()
    expect(screen.queryByTestId('cues-traktor-other-collection')).toBeNull()
    expect(traktorCollectionInUse).not.toHaveBeenCalled()
  })

  it('edits the grid of a WAV, whose clock is the one Surco draws, but opens no zones here', async () => {
    setup({ ...READ, clockLeadMs: 0 })
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() => expect(screen.getByTestId('cues-grid')).toBeInTheDocument())
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByTestId('cues-grid-right')).toBeEnabled()
    expect(screen.getByTestId('cues-grid-anchor')).toBeDisabled()
  })

  it('greys out the grid row of a file whose clock in this program is not measured yet', async () => {
    const getGridFit = vi.fn<Api['rekordboxGridFit']>(async () => ({ bpm: 120, firstMs: 0 }))
    setup(READ, undefined, undefined, {}, '', '/m/e.mp3')
    window.api.rekordboxGridFit = getGridFit
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() => expect(screen.getByTestId('cues-grid')).toBeInTheDocument())
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('title', expect.stringMatching(/Surco/))
    expect(getGridFit).not.toHaveBeenCalled()
  })

  it('saves to Engine DJ the cues Auto carried onto the fitted beats, as in rekordbox', async () => {
    const cues = [{ id: 'h1', ms: bar(16), kind: 1, color: 1 }]
    const rekordboxGridFit = vi.fn<Api['rekordboxGridFit']>(async () => ({
      bpm: 120,
      firstMs: 454,
    }))
    const { saveRekordboxCues } = setup(
      { ...READ, clockLeadMs: 0, cues },
      READ.contentId,
      async () => null,
      { rekordboxGridFit },
    )
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() => expect(screen.getByTestId('cues-grid-auto')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-grid-auto'))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const [[req]] = saveRekordboxCues.mock.calls[0]
    expect(req.wanted?.map((c) => c.ms)).toEqual([bar(16) - 46])
  })

  it('leaves a grid the DJ locked in the program alone, and says so', async () => {
    setup({ ...READ, clockLeadMs: 0, gridLocked: true })
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() => expect(screen.getByTestId('cues-grid')).toBeInTheDocument())
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('cues-grid')).toHaveAttribute(
      'title',
      expect.stringMatching(/locked/i),
    )
  })
})
