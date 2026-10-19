// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { cueChanges, type WantedCue } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import type { TrackCues } from '../../../shared/types'
import '../i18n'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)

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

function setup(read: TrackCues | null | Error = READ, queued: WantedCue[] | null | Error = null) {
  const logError = vi.fn<Api['logError']>()
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
  const undoRekordboxCues = vi.fn<Api['undoRekordboxCues']>(async () => {})
  const rekordboxTrackCues = vi.fn<Api['rekordboxTrackCues']>(async () => {
    if (read instanceof Error) throw read
    return read
  })
  const rekordboxQueuedCues = vi.fn<Api['rekordboxQueuedCues']>(async () => {
    if (queued instanceof Error) throw queued
    return queued
  })
  installApi({
    rekordboxTrackCues,
    rekordboxQueuedCues,
    saveRekordboxCues,
    undoRekordboxCues,
    logError,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CuesSection
        cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
        open
        onToggle={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return {
    logError,
    saveRekordboxCues,
    undoRekordboxCues,
    rekordboxTrackCues,
    rekordboxQueuedCues,
    client,
  }
}

const clickAt = (ms: number) =>
  fireEvent.click(screen.getByTestId('cue-wave'), { clientX: (ms / 400000) * 400, clientY: 40 })

describe('CuesSection', () => {
  it('draws the countdown live after marking a drop', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-drop-${bar(64)}`)).toBeInTheDocument()
  })

  it('saves the drops with the fingerprint it read', async () => {
    const { saveRekordboxCues } = setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    expect(screen.getByTestId('cues-save')).toBeDisabled()
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(saveRekordboxCues).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: '103',
        path: '/m/g.wav',
        label: 'Gowan',
        fingerprint: 'f0',
        wanted: expect.arrayContaining([{ ms: bar(64), kind: 0, color: null }]),
      }),
    )
  })

  it('computes a re-save against the drops rekordbox holds, not against the first queued save', async () => {
    const { saveRekordboxCues } = setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    clickAt(bar(96))
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(saveRekordboxCues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentId: '103',
        fingerprint: 'f0',
        wanted: expect.arrayContaining([
          { ms: bar(64), kind: 0, color: null },
          { ms: bar(96), kind: 0, color: null },
        ]),
      }),
    )
  })

  it('goes back to what rekordbox says with Undo', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    expect(screen.queryByTestId(`cue-wave-drop-${bar(64)}`)).toBeNull()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('saves a countdown left incomplete on drops already in rekordbox without touching the drops', async () => {
    const { saveRekordboxCues } = setup({
      ...READ,
      cues: [
        { id: 'drop', ms: bar(64), kind: 0, color: null },
        { id: 'a', ms: bar(48), kind: 1, color: 1 },
      ],
    })
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('cues-save')).toBeEnabled()
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(saveRekordboxCues).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: '103',
        fingerprint: 'f0',
        wanted: expect.arrayContaining([
          { id: 'drop', ms: bar(64), kind: 0, color: null },
          { ms: bar(16), kind: 1, color: 42 },
        ]),
      }),
    )
  })

  it('keeps Save off when the drawn plan is already what rekordbox holds', async () => {
    const outcome = cueChanges(
      [],
      [bar(64)],
      [],
      GRID.map((g) => g.ms),
      [],
    )
    if (outcome.status !== 'plan') throw new Error('expected a plan')
    setup({ ...READ, cues: outcome.changes.insert.map((c, i) => ({ id: `w${i}`, ...c })) })
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('says hand-placed hot cues stay as they are', async () => {
    setup({ ...READ, cues: [{ id: 'm', ms: bar(40), kind: 1, color: 1 }] })
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    expect(screen.getByTestId('cues-manual')).toBeInTheDocument()
  })

  it('draws hand-placed hot cues of any colour or letter visibly, never in a countdown colour', async () => {
    setup({
      ...READ,
      cues: [
        { id: 'a', ms: bar(40), kind: 1, color: 0 },
        { id: 'b', ms: bar(80), kind: 2, color: null },
        { id: 'i', ms: bar(120), kind: 3, color: null },
      ],
    })
    await waitFor(() => expect(screen.getByTestId('cues-manual')).toBeInTheDocument())
    const legend = [
      'var(--color-accent)',
      'var(--color-good)',
      'var(--color-danger)',
      'var(--color-warn)',
    ]
    const expected = { A: 0, B: null, C: null }
    for (const letter of ['A', 'B', 'C'] as const) {
      const cueLine = screen.getByTestId(`cue-wave-hot-${letter}`)
      expect(cueLine).toHaveTextContent(letter)
      expect(cueLine).toHaveStyle({ backgroundColor: hotCueColor(expected[letter]) })
      expect(legend).not.toContain(cueLine.style.backgroundColor)
    }
  })

  it('offers no marking on a track rekordbox has not analysed', async () => {
    setup({ ...READ, analysed: false, grid: [] })
    await waitFor(() => expect(screen.getByTestId('cues-unanalysed')).toBeInTheDocument())
    expect(screen.queryByTestId('cue-wave')).toBeNull()
    expect(screen.queryByTestId('cues-save')).toBeNull()
  })

  it('offers no plan on a track without a grid even if rekordbox calls it analysed', async () => {
    setup({ ...READ, grid: [] })
    await waitFor(() => expect(screen.getByTestId('cues-unanalysed')).toBeInTheDocument())
    expect(screen.queryByTestId('cues-save')).toBeNull()
  })

  it('keeps Guardar and Deshacer on one line each, letting the legend wrap instead', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeInTheDocument())
    expect(screen.getByTestId('cues-save')).toHaveClass('whitespace-nowrap')
    expect(screen.getByTestId('cues-undo')).toHaveClass('whitespace-nowrap')
    expect(screen.getByTestId('cues-actions')).toHaveClass('flex-wrap')
  })

  it('shows the legend', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cues-legend')).toHaveTextContent('16 bars'))
  })

  it('explains it could not read rekordbox when the read fails', async () => {
    setup(new Error('boom'))
    await waitFor(() => expect(screen.getByTestId('cues-unreadable')).toBeInTheDocument())
    expect(screen.queryByTestId('cues-save')).toBeNull()
  })

  it('explains it could not read rekordbox when there is no collection', async () => {
    setup(null)
    await waitFor(() => expect(screen.getByTestId('cues-unreadable')).toBeInTheDocument())
  })

  it('shows the drops of a queued save faint, so the user sees what will be written', async () => {
    setup(READ, [{ ms: bar(64), kind: 0, color: null }])
    await waitFor(() =>
      expect(screen.getByTestId(`cue-wave-drop-${bar(64)}`)).toHaveAttribute(
        'data-pending',
        'true',
      ),
    )
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
  })

  it('still computes against the drops rekordbox holds when a save is queued', async () => {
    const { saveRekordboxCues } = setup(READ, [{ ms: bar(64), kind: 0, color: null }])
    await waitFor(() => expect(screen.getByTestId(`cue-wave-drop-${bar(64)}`)).toBeInTheDocument())
    clickAt(bar(96))
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(saveRekordboxCues).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: '103',
        fingerprint: 'f0',
        wanted: expect.arrayContaining([
          { ms: bar(64), kind: 0, color: null },
          { ms: bar(96), kind: 0, color: null },
        ]),
      }),
    )
  })

  it('takes the queued save back with Undo and returns to what rekordbox says', async () => {
    const { undoRekordboxCues, rekordboxQueuedCues } = setup(READ, [
      { ms: bar(64), kind: 0, color: null },
    ])
    await waitFor(() => expect(screen.getByTestId(`cue-wave-drop-${bar(64)}`)).toBeInTheDocument())
    rekordboxQueuedCues.mockResolvedValue(null)
    fireEvent.click(screen.getByTestId('cues-undo'))
    expect(undoRekordboxCues).toHaveBeenCalledWith('103')
    await waitFor(() => expect(screen.queryByTestId(`cue-wave-drop-${bar(64)}`)).toBeNull())
  })

  it('draws what rekordbox now holds as written once the queue landed and the cues were re-read', async () => {
    const { rekordboxTrackCues, client } = setup(READ, [{ ms: bar(64), kind: 0, color: null }])
    await waitFor(() =>
      expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true'),
    )
    const outcome = cueChanges(
      [],
      [bar(64)],
      [],
      GRID.map((g) => g.ms),
      [],
    )
    if (outcome.status !== 'plan') throw new Error('expected a plan')
    const written: TrackCues = {
      ...READ,
      fingerprint: 'f1',
      cues: outcome.changes.insert.map((c, i) => ({ id: `w${i}`, ...c })),
    }
    rekordboxTrackCues.mockResolvedValue(written)
    await client.invalidateQueries({ queryKey: ['rekordbox-track-cues'] })
    await waitFor(() =>
      expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'false'),
    )
  })

  it('shows what rekordbox says and logs when the queued save cannot be read', async () => {
    const { logError } = setup(READ, new Error('ipc down'))
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('ipc down'))
  })
})
