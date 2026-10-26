// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { DropInput } from '../../../shared/dropDetect'
import type { SaveCuesOutcome, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

const detectDrops = vi.hoisted(() => vi.fn<(input: DropInput) => number[]>())
vi.mock('../../../shared/dropDetect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/dropDetect')>()),
  detectDrops,
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
  saved: SaveCuesOutcome = 'queued',
  contentId = 'traktor:HD/:m/:e.wav',
  dropInput: Api['rekordboxCueDropInput'] = async () => null,
  canSave = true,
) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => saved)
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
    setup(READ, 'queued', 'traktor:HD/:m/:e.wav', dropInput)
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
    setup(READ, 'queued', 'traktor:HD/:m/:e.wav', async () => null, false)
    await ready()
    await waitFor(() => expect(screen.getByTestId('cues-auto-mark')).toBeDisabled())
    expect(screen.getByTestId('cues-traktor-no-collection')).toHaveTextContent(
      'Choose your collection.nml in Settings → Output → Traktor so Surco can save',
    )
    markAt(bar(8))
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })
})
