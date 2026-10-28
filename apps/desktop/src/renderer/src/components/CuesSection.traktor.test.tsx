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
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { startDraft } from '../lib/cueDraft'
import { cueDraftKey, keepDraft, resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
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
  contentId: 'traktor:HD/:m/:e.wav',
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
  contentId = 'traktor:HD/:m/:e.wav',
  dropInput: Api['rekordboxCueDropInput'] = async () => null,
  canSave = true,
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
    traktorCanSave: async () => canSave,
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

describe('CuesSection on a Traktor track', () => {
  it('saves to Traktor', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-save')).toHaveAccessibleName('Save to Traktor')
  })

  it('asks main for what to detect on, since Traktor keeps no phrases', async () => {
    const dropInput = vi.fn<Api['rekordboxCueDropInput']>(async () => null)
    setup(READ, 'traktor:HD/:m/:e.wav', dropInput)
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    await waitFor(() => expect(dropInput).toHaveBeenCalledWith('traktor:HD/:m/:e.wav'))
  })

  it('says once, in the section help, how Traktor colours cues', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('section-help')).toHaveTextContent(
      "Traktor colours each cue by its type. Surco saves them as normal cues, in blue, and leaves button 1 to Traktor's AutoGrid",
    )
  })

  it('keeps Auto mark and Save off until the collection is confirmed, saying where to set it', async () => {
    setup(READ, 'traktor:HD/:m/:e.wav', async () => null, false)
    await ready()
    await waitFor(() => expect(screen.getByTestId('cues-auto-mark')).toBeDisabled())
    expect(screen.getByTestId('cues-traktor-no-collection')).toHaveTextContent(
      'Choose your collection.nml in Settings → Output → Traktor so Surco can save',
    )
    markAt(bar(8))
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  // Where the DJ is when a save goes nowhere: a Traktor 4.4.0 reading the 4.0.2 folder never
  // saw one cue, and the editor said nothing. It names the collection Traktor uses.
  it('says when Traktor uses another collection than the one Surco saves to', async () => {
    const chosen = '/Users/dj/Traktor 4.4.0/collection.nml'
    const other = '/Users/dj/Traktor 4.0.2/collection.nml'
    const asked = vi.fn(async (path: string) => (path === chosen ? other : null))
    installApi({
      rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
      rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
      traktorCanSave: async () => true,
      traktorCollectionInUse: asked,
    })
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SettingsProvider
          settings={{ cueFlows: KEPT, activeCueFlow: 'mine', traktorNmlPath: chosen }}
        >
          <CuesSection
            cue={{ contentId: 'traktor:HD/:m/:e.wav', path: '/m/e.wav', label: 'Tengo' }}
            open
            onToggle={vi.fn()}
          />
        </SettingsProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('cues-traktor-other-collection')).toHaveTextContent(other)
  })

  it('lets the DJ save as soon as the collection is confirmed in Settings, without restarting', async () => {
    let confirmed = false
    installApi({
      rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
      rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
      traktorCanSave: vi.fn(async () => confirmed),
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    const view = (traktorNmlPath: string) => (
      <QueryClientProvider client={client}>
        <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', traktorNmlPath }}>
          <CuesSection
            cue={{ contentId: 'traktor:HD/:m/:e.wav', path: '/m/e.wav', label: 'Tengo' }}
            open
            onToggle={vi.fn()}
          />
        </SettingsProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(view(''))
    await ready()
    await waitFor(() => expect(screen.getByTestId('cues-auto-mark')).toBeDisabled())
    confirmed = true
    rerender(view('/Users/dj/collection.nml'))
    await waitFor(() => expect(screen.getByTestId('cues-auto-mark')).toBeEnabled())
    expect(screen.queryByTestId('cues-traktor-no-collection')).not.toBeInTheDocument()
  })

  it('saves the other libraries’ tracks from Save all but keeps a Traktor track back until the collection is confirmed', async () => {
    for (const id of ['103', '104'])
      keepDraft(
        id,
        cueDraftKey(id, 'f0', null),
        startDraft([{ ms: bar(16), kind: 1, color: 1 }], 'mine'),
        {
          path: `/m/${id}.wav`,
          label: id,
          fingerprint: 'f0',
        },
      )
    const { saveRekordboxCues } = setup(READ, 'traktor:HD/:m/:e.wav', async () => null, false)
    await ready()
    markAt(bar(8))
    const all = await screen.findByTestId('cues-save-all')
    await waitFor(() => expect(all).toBeEnabled())
    fireEvent.click(all)
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const saved = saveRekordboxCues.mock.calls.flatMap(([reqs]) => reqs.map((r) => r.contentId))
    expect(saved.sort()).toEqual(['103', '104'])
  })

  // Traktor colours each cue by its type and keeps no colour of its own, so a colour
  // picked in Surco would never reach Traktor: the editor offers none and paints every
  // cue it adds, proposals included, in the blue Traktor shows a plain cue in.
  const traktorBlue = (() => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = hotCueColor(TRAKTOR_CUE_COLOR)
    return probe.style.backgroundColor
  })()

  it('previews Auto mark in Traktor blue, not in the flow colours', async () => {
    dropProposals.mockReset().mockReturnValue([{ ms: bar(64), sure: true, quietBars: 8 }])
    const input: DropInput = { grid: GRID, phrases: [], words: new Uint16Array(3000) }
    setup(READ, 'traktor:HD/:m/:e.wav', async () => input)
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    await waitFor(() =>
      expect(screen.getAllByTestId(/^cue-wave-ghost-hot-/).length).toBeGreaterThan(0),
    )
    for (const mark of screen.getAllByTestId(/^cue-wave-ghost-hot-/))
      expect((mark.querySelector('[data-ghost-fill]') as HTMLElement).style.backgroundColor).toBe(
        traktorBlue,
      )
  })

  it('offers no colour for a Traktor hot cue, from its button or its marker', async () => {
    setup()
    await ready()
    markAt(bar(64))
    const hot = await screen.findAllByTestId(/^cue-wave-hot-/)
    expect(hot[0].style.backgroundColor).toBe(traktorBlue)
    fireEvent.click(hot[0])
    await waitFor(() => expect(screen.getByTestId('cues-delete')).toBeInTheDocument())
    expect(screen.queryByTestId('cues-colour')).not.toBeInTheDocument()
    fireEvent.contextMenu(hot[0])
    expect(screen.queryByTestId('cues-menu-colour')).not.toBeInTheDocument()
  })

  it('says the CALLs stay in Surco, since Traktor has none', async () => {
    setup()
    await ready()
    markAt(bar(64))
    expect(await screen.findByTestId('cues-traktor-calls')).toHaveTextContent(
      'Traktor has no CALLs, so they are not saved. Only the hot cues reach Traktor',
    )
  })
})
