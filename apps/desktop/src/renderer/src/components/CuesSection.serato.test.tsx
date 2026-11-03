// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import type { TrackCues } from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import '../i18n'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
afterEach(resetEditorSections)

const ID = 'serato:/Music/s.mp3'
const READ: TrackCues = {
  contentId: ID,
  analysed: false,
  grid: [],
  strong: [],
  phrases: [],
  cues: [
    { id: '0', ms: 57606, kind: HOT_KINDS[0], color: 2, name: 'Intro' },
    { id: '1', ms: 71553, kind: HOT_KINDS[1], color: 5 },
  ],
  wave: null,
  durationMs: 300000,
  fingerprint: 'f0',
  gridFingerprint: '',
}

function setup(read: TrackCues | null | Error = READ, running = false) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
  const seratoRunning = vi.fn<Api['seratoRunning']>(async () => running)
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => {
      if (read instanceof Error) throw read
      return read
    }),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    saveRekordboxCues,
    seratoRunning,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{}}>
        <CuesSection
          cue={{ contentId: ID, path: '/Music/s.mp3', label: 'S' }}
          open
          onToggle={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { saveRekordboxCues, seratoRunning }
}

describe('CuesSection on a Serato track', () => {
  it('shows the hot cues Serato saved, each on its letter with its colour, time and name', async () => {
    setup()
    const a = await screen.findByTestId('cues-serato-A')
    expect(a).toHaveTextContent('A')
    expect(a).toHaveTextContent('0:57.6')
    expect(a).toHaveTextContent('Intro')
    expect(screen.getByTestId('cues-serato-A-letter')).toHaveStyle({
      backgroundColor: hotCueColor(2),
    })
    expect(screen.getByTestId('cues-serato-B')).toHaveTextContent('1:11.5')
  })

  it('offers no way to change or save them, and says Serato is read-only, so nothing is ever written to Serato', async () => {
    setup()
    await screen.findByTestId('cues-serato-A')
    expect(screen.getByTestId('cues-read-only')).toHaveTextContent('Serato is read-only in Surco')
    expect(screen.queryByTestId('cues-save')).toBeNull()
    expect(screen.queryByTestId('cues-auto-mark')).toBeNull()
    expect(screen.queryByTestId('cues-editor')).toBeNull()
    expect(screen.queryByTestId('cues-clear-all')).toBeNull()
  })

  it('warns that the cues may be out of date while Serato is open, since Serato writes them when it closes', async () => {
    setup(READ, true)
    expect(await screen.findByTestId('cues-serato-running')).toHaveTextContent(
      'Serato is open. The cues may be out of date until you close it.',
    )
  })

  it('does not warn when Serato is closed', async () => {
    const { seratoRunning } = setup(READ, false)
    await screen.findByTestId('cues-serato-A')
    await waitFor(() => expect(seratoRunning).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('cues-serato-running')).toBeNull())
  })

  it('says the track has no hot cues when Serato marked none', async () => {
    setup({ ...READ, cues: [] })
    expect(await screen.findByTestId('cues-serato-none')).toHaveTextContent(
      'Serato has no hot cues on this track',
    )
    expect(screen.getByTestId('cues-read-only')).toBeInTheDocument()
  })

  it('says the cues could not be read when the file is gone, without an error', async () => {
    setup(null)
    expect(await screen.findByTestId('cues-unreadable')).toHaveTextContent(
      'Could not read the cues from Serato',
    )
  })
})
