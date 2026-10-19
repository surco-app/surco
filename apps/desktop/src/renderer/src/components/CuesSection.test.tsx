// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
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

function setup(read: TrackCues = READ) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => read),
    saveRekordboxCues,
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CuesSection
        cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
        open
        onToggle={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { saveRekordboxCues }
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
    expect(saveRekordboxCues).toHaveBeenCalledWith({
      contentId: '103',
      path: '/m/g.wav',
      label: 'Gowan',
      drops: [bar(64)],
      previousDrops: [],
      fingerprint: 'f0',
    })
  })

  it('computes a re-save against the drops rekordbox holds, not against the first queued save', async () => {
    const { saveRekordboxCues } = setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    clickAt(bar(96))
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(saveRekordboxCues).toHaveBeenLastCalledWith({
      contentId: '103',
      path: '/m/g.wav',
      label: 'Gowan',
      drops: [bar(64), bar(96)],
      previousDrops: [],
      fingerprint: 'f0',
    })
  })

  it('goes back to what rekordbox says with Undo', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    expect(screen.queryByTestId(`cue-wave-drop-${bar(64)}`)).toBeNull()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('says hand-placed hot cues stay as they are', async () => {
    setup({ ...READ, cues: [{ id: 'm', ms: bar(40), kind: 1, color: 1 }] })
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    expect(screen.getByTestId('cues-manual')).toBeInTheDocument()
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

  it('shows the legend', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cues-legend')).toHaveTextContent('16 bars'))
  })
})
