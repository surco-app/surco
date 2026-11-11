// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import { HOT_KINDS } from '../../../shared/cueRules'
import type { TrackCues } from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import '../i18n'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { type ApiOverrides, djReads, installApi, type ProgramReads } from '../test/api'
import { hoverTooltip } from '../test/tooltip'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
afterEach(resetEditorSections)

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

const ID = 'serato:/Music/s.mp3'
const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]
const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const READ: TrackCues = {
  contentId: ID,
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [],
  cues: [{ id: '0', ms: bar(8), kind: HOT_KINDS[0], color: 2, name: 'Intro' }],
  loops: [{ id: '0', startMs: bar(16), endMs: bar(24), name: 'Build' }],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
  gridFingerprint: '',
}

function setup(read: TrackCues | null | Error = READ, running = false, over: ApiOverrides = {}) {
  const saveRekordboxCues = vi.fn<Api['cues']['save']>(async () => {})
  const seratoRunning = vi.fn<ProgramReads['running']>(async () => running)
  installApi({
    dj: djReads({ serato: { running: seratoRunning } }),
    ...over,
    cues: {
      trackCues: vi.fn<Api['cues']['trackCues']>(async () => {
        if (read instanceof Error) throw read
        return read
      }),
      queued: vi.fn<Api['cues']['queued']>(async () => null),
      save: saveRekordboxCues,
      ...over.cues,
    },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
        <CuesSection
          cue={{ contentId: ID, path: '/Music/s.mp3', label: 'S' }}
          open
          onToggle={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { saveRekordboxCues, seratoRunning, client }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const markAt = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
  fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
}

describe('CuesSection on a Serato track', () => {
  it('opens the normal cue editor and saves the marks to Serato under the track’s Serato id', async () => {
    const { saveRekordboxCues } = setup()
    await ready()
    expect(screen.getByTestId('cues-save')).toHaveAccessibleName('Save to Serato')
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(saveRekordboxCues.mock.calls[0][0][0]).toMatchObject({
      contentId: ID,
      path: '/Music/s.mp3',
      label: 'S',
      fingerprint: 'f0',
    })
  })

  it('lets the DJ pick any colour for a Serato hot cue, since Serato keeps the colour', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getAllByTestId(/^cue-wave-hot-/)[0])
    expect(await screen.findByTestId('cues-colour')).toBeInTheDocument()
  })

  it('says while Serato is open that the changes will be saved once it is closed, and still lets them be saved', async () => {
    const { saveRekordboxCues } = setup(READ, true)
    await ready()
    markAt(bar(64))
    expect(await screen.findByTestId('cues-serato-waiting')).toHaveTextContent(
      'Serato is open. Your changes will be saved when you close it',
    )
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
  })

  it('keeps quiet while Serato is open but there is nothing to save', async () => {
    const { client } = setup(READ, true)
    await ready()
    await waitFor(() =>
      expect(client.getQueryState(['serato-running', ID])?.status).toBe('success'),
    )
    expect(screen.queryByTestId('cues-serato-waiting')).toBeNull()
  })

  it('warns while Serato is open over edits already waiting in the queue', async () => {
    setup(READ, true, {
      cues: {
        queued: vi.fn<Api['cues']['queued']>(async () => ({
          wanted: [{ ms: bar(64), kind: HOT_KINDS[1], color: 1 }],
          fingerprint: 'f0',
        })),
      },
    })
    expect(await screen.findByTestId('cues-serato-waiting')).toBeInTheDocument()
  })

  it('notices Serato being opened while the editor stays open, without reopening the track', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const seratoRunning = vi
        .fn<ProgramReads['running']>()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true)
      setup(READ, false, { dj: djReads({ serato: { running: seratoRunning } }) })
      await ready()
      markAt(bar(64))
      await waitFor(() => expect(seratoRunning).toHaveBeenCalledTimes(1))
      expect(screen.queryByTestId('cues-serato-waiting')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(await screen.findByTestId('cues-serato-waiting')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps Serato’s beat grid as Serato has it and says why', async () => {
    setup({ ...READ, clockLeadMs: 0 })
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() => expect(screen.getByTestId('cues-grid')).toBeInTheDocument())
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(hoverTooltip(screen.getByTestId('cues-grid'))).toEqual(
      "Serato's beat grid comes from Serato and can't be changed here",
    )
    expect(screen.getByTestId('cues-grid-right')).toBeDisabled()
  })

  it('does not warn when Serato is closed', async () => {
    const { client } = setup(READ, false)
    await ready()
    await waitFor(() =>
      expect(client.getQueryState(['serato-running', ID])?.status).toBe('success'),
    )
    expect(screen.queryByTestId('cues-serato-waiting')).toBeNull()
  })

  it('offers Auto mark on a track Serato has a beat grid for', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-auto-mark')).toBeInTheDocument()
  })

  it('offers neither Auto mark nor saving on a track without a Serato beat grid, and says Serato has not analysed it', async () => {
    setup({ ...READ, analysed: false, grid: [] })
    expect(await screen.findByTestId('cues-unanalysed')).toHaveTextContent(
      'Serato has not analysed this track yet',
    )
    expect(screen.queryByTestId('cues-auto-mark')).toBeNull()
    expect(screen.queryByTestId('cues-save')).toBeNull()
  })

  it('says the CALLs stay in Surco, since Serato has none', async () => {
    setup()
    await ready()
    markAt(bar(64))
    expect(await screen.findByTestId('cues-serato-calls')).toHaveTextContent(
      'Serato has no CALLs, so they are not saved. Only the hot cues reach Serato',
    )
  })

  it('says in Serato’s words when the save did not go through', async () => {
    setup(READ, false, {
      cues: {
        save: vi.fn<Api['cues']['save']>(async () => {
          throw new Error('ipc down')
        }),
      },
    })
    await ready()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(await screen.findByTestId('cues-save-failed')).toHaveTextContent(
      'Could not save to Serato. The cues are still not saved',
    )
  })

  it('says a queued save is out of date once the track changed in Serato', async () => {
    setup(READ, false, {
      cues: {
        queued: vi.fn<Api['cues']['queued']>(async () => ({
          wanted: [{ ms: bar(64), kind: HOT_KINDS[1], color: 1 }],
          fingerprint: 'older',
        })),
      },
    })
    expect(await screen.findByTestId('cues-queued-stale')).toHaveTextContent(
      'The queued save was made before the track changed in Serato and is out of date. You see what Serato holds now.',
    )
  })

  it('says Surco could not read the audio when Auto mark has nothing to detect on', async () => {
    setup(READ, false, {
      cues: {
        dropInput: vi.fn<Api['cues']['dropInput']>(async () => null),
      },
    })
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    expect(await screen.findByTestId('cues-auto-unreadable')).toHaveTextContent(
      'Surco could not read the audio of this track',
    )
  })

  it('says the cues could not be read when the file is gone, without an error', async () => {
    setup(null)
    expect(await screen.findByTestId('cues-unreadable')).toHaveTextContent(
      'Could not read the cues from Serato',
    )
  })
})
