// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import { resetEditorSections } from '../hooks/useEditorSections'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { runKeyClaim } from '../lib/spaceClaim'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32]
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

const play = vi.fn<() => Promise<void>>()
const pause = vi.fn<() => void>()
const audios: { onloadedmetadata: (() => void) | null; currentTime: number }[] = []

function stubSound() {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  vi.stubGlobal(
    'Audio',
    class {
      onloadedmetadata: (() => void) | null = null
      onended: (() => void) | null = null
      currentTime = 0
      play = play
      pause = pause
      load = vi.fn<() => void>()
      removeAttribute = vi.fn<(name: string) => void>()
      constructor() {
        audios.push(this)
      }
    },
  )
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
}

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
    height: 100,
    right: 400,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(settings: Partial<Settings> = {}) {
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (cue = { contentId: '103', path: '/m/g.wav', label: 'Gowan' }) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', ...settings }}>
        <CuesSection cue={cue} open onToggle={vi.fn()} />
      </SettingsProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(tree())
  return {
    changeTrack: (cue: { contentId: string; path: string; label: string }) => rerender(tree(cue)),
  }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-detail')).toBeInTheDocument())
const position = () => screen.getByTestId('cues-position').textContent
const marks = () => screen.queryAllByTestId(/^cue-wave-(hot|call)-/)
const placeMode = () => screen.getByTestId('cue-place-mode')
const clickDetail = (x: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: x })
  fireEvent.mouseUp(window, { clientX: x })
}

describe('CuesSection folded', () => {
  it('moves the playhead to the beat with a plain click on the strip, without opening full screen or placing', async () => {
    setup()
    await ready()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128.3 })
    fireEvent.mouseUp(window, { clientX: 128.3 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 128.3 })
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'false')
    expect(position()).toBe('2:08.5')
    expect(marks()).toHaveLength(0)
  })

  it('draws both waves on one surface and a row with play, zoom, time and Guardar, with the flow control up in the header', async () => {
    setup()
    await ready()
    const surface = screen.getByTestId('cues-surface')
    expect(surface).toContainElement(screen.getByTestId('cue-wave'))
    expect(surface).toContainElement(screen.getByTestId('cue-detail'))
    expect(screen.getByTestId('cue-detail').style.height).toBe('96px')
    const row = screen.getByTestId('cues-folded-row')
    for (const id of ['cues-play', 'cue-zoom-out', 'cue-zoom-in', 'cues-position', 'cues-save'])
      expect(row).toContainElement(screen.getByTestId(id))
    expect(screen.queryByTestId('cue-zoom-reset')).toBeNull()
    expect(row.className).toContain('whitespace-nowrap')
    const header = screen.getByTestId('cue-place-mode').closest('[data-testid="cues-section"]')
    expect(header).not.toBeNull()
    expect(surface).not.toContainElement(placeMode())
    expect(row).not.toContainElement(placeMode())
    expect(screen.getByTestId('cue-wave-view')).toBeInTheDocument()
  })

  it('keeps Guardar in place, quiet with nothing to save and filled once there is', async () => {
    setup()
    await ready()
    const save = screen.getByTestId('cues-save')
    expect(save).toBeDisabled()
    expect(save.className).not.toContain('bg-[var(--color-accent)]')
    fireEvent.click(placeMode())
    clickDetail(200)
    expect(screen.getByTestId('cues-save')).toBe(save)
    expect(save).toBeEnabled()
    expect(save.className).toContain('bg-[var(--color-accent)]')
  })

  it('starts out of place mode, so a click on the zoomed wave only moves the playhead to the beat and draws no ghost', async () => {
    setup()
    await ready()
    expect(placeMode()).toHaveAttribute('aria-pressed', 'false')
    expect(placeMode()).toHaveTextContent('My flow')
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 300 })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 64 })
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/)).toHaveLength(0)
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    clickDetail(300.3)
    expect(position()).toBe('0:08.0')
    expect(marks()).toHaveLength(0)
  })

  it('places the flow at the snapped beat with a click once place mode is on, and stays on to place again', async () => {
    setup()
    await ready()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    fireEvent.mouseUp(window, { clientX: 128 })
    fireEvent.click(placeMode())
    expect(placeMode()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 202 })
    expect(screen.getByTestId('cue-detail-ghost-call-128000')).toBeInTheDocument()
    clickDetail(202)
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(position()).toBe('2:08.0')
    expect(placeMode()).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns place mode on with the flow picked from the chevron, and off with Escape or another track', async () => {
    const { changeTrack } = setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-flow'))
    fireEvent.click(screen.getByTestId('cues-flow-option-one-at-32'))
    expect(placeMode()).toHaveAttribute('aria-pressed', 'true')
    expect(placeMode()).toHaveTextContent('One cue at 32')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(placeMode()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(placeMode())
    changeTrack({ contentId: '104', path: '/m/h.wav', label: 'Other' })
    await ready()
    expect(placeMode()).toHaveAttribute('aria-pressed', 'false')
  })

  it('spends the Escape that turns place mode off there, so the track stays selected, and lets the next Escape through', async () => {
    const onEscape = vi.fn<() => void>()
    renderHook(() =>
      useKeyboardShortcuts({
        isMac: true,
        overlayOpen: false,
        bindings: resolveBindings(),
        getCommands: () => [],
        onTogglePalette: () => {},
        onEscape,
        onStepTrack: () => {},
      }),
    )
    setup()
    await ready()
    fireEvent.click(placeMode())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(placeMode()).toHaveAttribute('aria-pressed', 'false')
    expect(onEscape).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('reads Manual and cannot place when Manual is picked from the chevron', async () => {
    setup()
    await ready()
    fireEvent.click(placeMode())
    fireEvent.click(screen.getByTestId('cues-flow'))
    fireEvent.click(screen.getByTestId('cues-flow-option-manual'))
    expect(placeMode()).toHaveTextContent('Manual')
    expect(placeMode()).toBeDisabled()
    expect(placeMode()).toHaveAttribute('aria-pressed', 'false')
    clickDetail(300)
    expect(marks()).toHaveLength(0)
  })

  it('plays from the folded section and stops when the track changes', async () => {
    stubSound()
    const { changeTrack } = setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(audios).toHaveLength(1)
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Pause')
    changeTrack({ contentId: '104', path: '/m/h.wav', label: 'Other' })
    expect(pause).toHaveBeenCalled()
  })

  it('lets Space stop the folded preview while it plays, instead of starting the mini-player over it, and gives Space back once stopped', async () => {
    stubSound()
    setup()
    await ready()
    expect(runKeyClaim('play')).toBe(false)
    fireEvent.click(screen.getByTestId('cues-play'))
    let handled = false
    act(() => {
      handled = runKeyClaim('play')
    })
    expect(handled).toBe(true)
    expect(pause).toHaveBeenCalled()
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
    expect(runKeyClaim('play')).toBe(false)
  })

  it('stops the preview when the mini-player starts, so two audios never sound together', async () => {
    stubSound()
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-play'))
    const player = document.createElement('audio')
    document.body.appendChild(player)
    act(() => {
      player.dispatchEvent(new Event('play'))
    })
    expect(pause).toHaveBeenCalled()
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
    player.remove()
  })

  it('zooms the folded zoomed wave with the buttons in the row and goes back to 16 bars with a double click on it', async () => {
    setup()
    await ready()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    fireEvent.mouseUp(window, { clientX: 128 })
    const width = () => screen.getByTestId('cue-wave-view').style.width
    expect(width()).toBe('8%')
    fireEvent.click(within(screen.getByTestId('cues-folded-row')).getByTestId('cue-zoom-in'))
    expect(width()).toBe('4%')
    fireEvent.doubleClick(screen.getByTestId('cue-detail'))
    expect(width()).toBe('8%')
  })

  it('keeps the zoom on a double click while placing, where clicks only place', async () => {
    setup()
    await ready()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    fireEvent.mouseUp(window, { clientX: 128 })
    fireEvent.click(within(screen.getByTestId('cues-folded-row')).getByTestId('cue-zoom-in'))
    fireEvent.click(placeMode())
    fireEvent.doubleClick(screen.getByTestId('cue-detail'))
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('4%')
  })
})
