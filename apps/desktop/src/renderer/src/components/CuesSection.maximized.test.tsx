// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
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
const TRACK = { title: 'Pray', artist: 'Gowan', bpm: '120', key: '6A' }

afterEach(() => {
  cleanup()
  resetEditorSections()
  resetCueSession()
  vi.unstubAllGlobals()
})

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

function setup(settings: Partial<Settings> | null = null) {
  const rekordboxCueWaveDetail = vi.fn<Api['rekordboxCueWaveDetail']>(async () => null)
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueWaveDetail,
  })
  const onJumpBars = vi.fn<(bars: CueJumpBars) => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={settings}>
        <CuesSection
          cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
          open
          onToggle={vi.fn()}
          track={TRACK}
          onJumpBars={onJumpBars}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { rekordboxCueWaveDetail, onJumpBars }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const maximize = async () => {
  await ready()
  fireEvent.click(screen.getByTestId('section-maximize'))
  await waitFor(() =>
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
  )
}
const seek = (ms: number) => fireEvent.click(screen.getByTestId('cue-wave'), { clientX: ms / 1000 })
const position = () => screen.getByTestId('cues-position').textContent

describe('CuesSection maximized', () => {
  it('stays the section of today while folded into the column', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'false')
    expect(screen.queryByTestId('cue-detail')).toBeNull()
    expect(screen.queryByTestId('cues-deck')).toBeNull()
    seek(128000)
    expect(screen.getByTestId('cue-wave-drop-128000')).toBeInTheDocument()
  })

  it('opens the full editor with the track header, the zoomed wave and the deck', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-header')).toHaveTextContent('Pray')
    expect(screen.getByTestId('cues-header')).toHaveTextContent('Gowan')
    expect(screen.getByTestId('cues-bpm')).toHaveTextContent('120 BPM')
    expect(screen.getByTestId('cues-key')).toHaveTextContent('6A')
    expect(position()).toBe('0:00.0')
    expect(screen.getByTestId('cues-remaining')).toHaveTextContent('-6:40.0')
    expect(screen.getByTestId('cue-detail')).toBeInTheDocument()
    expect(screen.getByTestId('cues-deck')).toBeInTheDocument()
    expect(screen.getByTestId('cues-save')).toBeInTheDocument()
  })

  it('asks main for the full colour wave only once maximized', async () => {
    const { rekordboxCueWaveDetail } = setup()
    await ready()
    expect(rekordboxCueWaveDetail).not.toHaveBeenCalled()
    await maximize()
    await waitFor(() => expect(rekordboxCueWaveDetail).toHaveBeenCalledWith('103'))
  })

  it('moves the playhead with a click on the overview instead of marking a drop', async () => {
    setup()
    await maximize()
    seek(100000)
    expect(position()).toBe('1:40.0')
    expect(screen.queryByTestId('cue-wave-drop-100000')).toBeNull()
  })

  it('places a hot cue with a pad, and the pad of a placed cue jumps back to it and selects it', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toBe('16%')
    seek(200000)
    fireEvent.click(screen.getByTestId('cues-pad-B'))
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(position()).toBe('1:04.0')
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'false')
  })

  it('puts one CALL at the playhead with MEMORY, walks the CALLs and deletes the one under the playhead', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.getAllByTestId('cue-wave-call-64000')).toHaveLength(1)
    seek(120000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory-prev'))
    expect(position()).toBe('1:04.0')
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(position()).toBe('2:00.0')
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.queryByTestId('cue-wave-call-120000')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
  })

  it('changes the jump with ‹ › and hands it on to be saved', async () => {
    const { onJumpBars } = setup()
    await maximize()
    expect(screen.getByTestId('cues-jump-value')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump-more'))
    expect(onJumpBars).toHaveBeenCalledWith(32)
  })

  it('shows the jump set in Settings', async () => {
    setup({ cueJumpBars: 64 })
    await maximize()
    expect(screen.getByTestId('cues-jump-value')).toHaveTextContent('64 bars')
  })

  it('keeps the playhead when the section is mounted again on maximize or restore', async () => {
    setup()
    await maximize()
    seek(64000)
    cleanup()
    setup()
    await ready()
    expect(position()).toBe('1:04.0')
  })

  it('closes the cue menu on Escape without restoring the full editor under it', async () => {
    setup()
    await maximize()
    const windowKeys = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', windowKeys)
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100 })
    fireEvent.keyDown(screen.getByTestId('cues-menu'), { key: 'Escape' })
    window.removeEventListener('keydown', windowKeys)
    expect(screen.queryByTestId('cues-menu')).toBeNull()
    expect(windowKeys).not.toHaveBeenCalled()
  })
})
