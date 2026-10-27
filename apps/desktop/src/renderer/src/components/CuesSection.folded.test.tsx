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
import type { Command } from '../lib/commands'
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

const rekordboxCueWaveDetail = vi.fn<Api['rekordboxCueWaveDetail']>(async () => null)

function setup(settings: Partial<Settings> = {}) {
  rekordboxCueWaveDetail.mockClear()
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueWaveDetail,
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
const seekStrip = (x: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: x })
  fireEvent.mouseUp(window, { clientX: x })
}
const ghostMarks = () =>
  screen
    .queryAllByTestId(/^cue-wave-ghost-(hot|call)-/)
    .map((el) => `${el.dataset.testid?.replace('ghost-', '')} ${el.style.left}`)
    .sort()
const placedMarks = () =>
  screen
    .queryAllByTestId(/^cue-wave-(hot|call)-/)
    .map((el) => `${el.dataset.testid} ${el.style.left}`)
    .sort()
const placeAtPlayhead = () => clickDetail(200)
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

  it('loads the detailed wave for the short zoomed wave while folded, so it has the resolution of full screen', async () => {
    setup()
    await ready()
    await waitFor(() => expect(rekordboxCueWaveDetail).toHaveBeenCalledWith('103'))
  })

  it('draws the overview strip from the detailed wave once it arrives, so the whole track shows real detail', async () => {
    rekordboxCueWaveDetail.mockResolvedValueOnce(new Uint16Array(3000).fill((7 << 13) | (20 << 2)))
    setup()
    await ready()
    expect(await screen.findByTestId('cue-wave-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-bars')).toBeNull()
  })

  it('draws both waves on one surface and a row with play, zoom, time and Guardar, with the flow control up in the header', async () => {
    setup()
    await ready()
    const surface = screen.getByTestId('cues-surface')
    expect(surface).toContainElement(screen.getByTestId('cue-wave'))
    expect(surface).toContainElement(screen.getByTestId('cue-detail'))
    expect(screen.getByTestId('cue-detail').style.height).toBe('96px')
    const row = screen.getByTestId('cues-folded-row')
    for (const id of [
      'cues-play',
      'cue-zoom-out',
      'cue-zoom-reset',
      'cue-zoom-in',
      'cues-position',
      'cues-save',
    ])
      expect(row).toContainElement(screen.getByTestId(id))
    expect(row.className).toContain('whitespace-nowrap')
    expect(screen.queryByTestId('cues-mark-here')).toBeNull()
    expect(screen.queryByTestId('cue-place-mode')).toBeNull()
    expect(surface).not.toContainElement(screen.getByTestId('cues-flow'))
    expect(row).not.toContainElement(screen.getByTestId('cues-flow'))
    expect(screen.getByTestId('cue-wave-view')).toBeInTheDocument()
  })

  it('says the bars to the point in the short form in the row, so the count of what does not fit has room beside it', async () => {
    setup()
    await ready()
    seekStrip(128)
    placeAtPlayhead()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 96 })
    fireEvent.mouseUp(window, { clientX: 96 })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent(/^16 to CALL$/)
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 127.4 })
    fireEvent.mouseUp(window, { clientX: 127.4 })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent(/^1 to CALL$/)
  })

  it('keeps Guardar in place, quiet with nothing to save and filled once there is', async () => {
    setup()
    await ready()
    const save = screen.getByTestId('cues-save')
    expect(save).toBeDisabled()
    expect(save.className).not.toContain('bg-[var(--color-accent)]')
    seekStrip(128)
    placeAtPlayhead()
    expect(screen.getByTestId('cues-save')).toBe(save)
    expect(save).toBeEnabled()
    expect(save.className).toContain('bg-[var(--color-accent)]')
  })

  it('never places with a click or a drag on the strip, nor with a drag on the zoomed wave, which only move the playhead', async () => {
    setup()
    await ready()
    seekStrip(128.3)
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 140 })
    fireEvent.mouseUp(window, { clientX: 140 })
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 250 })
    fireEvent.mouseUp(window, { clientX: 250 })
    expect(marks()).toHaveLength(0)
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'false')
  })

  it('draws the flow at the playhead, follows the pointer over the zoomed wave, and a click there places exactly what it showed in one undo step without moving the playhead', async () => {
    setup()
    await ready()
    seekStrip(128.3)
    expect(screen.getByTestId('cue-wave-ghost-call-128000')).toBeInTheDocument()
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 300 })
    expect(screen.queryByTestId('cue-wave-ghost-call-128000')).toBeNull()
    const shown = ghostMarks()
    expect(screen.getByTestId('cue-wave-ghost-call-136000')).toBeInTheDocument()
    expect(shown.length).toBeGreaterThan(1)
    fireEvent.mouseLeave(screen.getByTestId('cue-detail'))
    expect(screen.getByTestId('cue-wave-ghost-call-128000')).toBeInTheDocument()
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 300 })
    clickDetail(300)
    expect(placedMarks()).toEqual(shown)
    expect(position()).toBe('2:08.5')
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'z', metaKey: true })
    expect(marks()).toHaveLength(0)
  })

  it('undoes with ⌘Z and redoes with ⇧⌘Z while working in the folded section', async () => {
    setup()
    await ready()
    seekStrip(128)
    placeAtPlayhead()
    const editor = screen.getByTestId('cues-editor')
    fireEvent.keyDown(editor, { key: 'z', metaKey: true })
    expect(marks()).toHaveLength(0)
    fireEvent.keyDown(editor, { key: 'Z', metaKey: true, shiftKey: true })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
  })

  it('marks with Enter while the focus is in the folded section, and leaves Enter alone elsewhere', async () => {
    setup()
    await ready()
    seekStrip(128)
    const outside = document.createElement('div')
    outside.tabIndex = 0
    document.body.appendChild(outside)
    act(() => outside.focus())
    fireEvent.keyDown(outside, { key: 'Enter' })
    expect(marks()).toHaveLength(0)
    act(() => screen.getByTestId('cue-wave').focus())
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'Enter' })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    outside.remove()
  })

  it('offers Descartar cambios in the flow menu below Borrar todas las cues, only once there are changes, and keeps it out of the row where it read as undo', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-flow'))
    const clear = screen.getByTestId('cues-flow-option-clear-cues')
    const discard = screen.getByTestId('cues-flow-option-discard-cues')
    expect(discard).toHaveTextContent('Discard changes')
    expect(clear.compareDocumentPosition(discard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(discard).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(discard, { key: 'Escape' })
    seekStrip(128)
    placeAtPlayhead()
    expect(screen.getByTestId('cues-folded-row')).not.toContainElement(
      screen.queryByTestId('cues-undo'),
    )
    fireEvent.click(screen.getByTestId('cues-flow'))
    expect(screen.getByTestId('cues-flow-option-discard-cues')).not.toHaveAttribute('aria-disabled')
    fireEvent.click(screen.getByTestId('cues-flow-option-discard-cues'))
    expect(marks()).toHaveLength(0)
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('undoes one step with the undo button right before Guardar, enabled only with something to undo, as ⌘Z does', async () => {
    setup()
    await ready()
    const undo = screen.getByTestId('cues-step-back')
    expect(screen.getByTestId('cues-folded-row')).toContainElement(undo)
    expect(undo.nextElementSibling).toBe(screen.getByTestId('cues-save'))
    expect(undo).toHaveAccessibleName('Undo')
    expect(undo).toHaveAttribute('title', 'Undo ⌘Z')
    expect(undo).toBeDisabled()
    seekStrip(128)
    placeAtPlayhead()
    seekStrip(200)
    placeAtPlayhead()
    expect(screen.getByTestId('cue-wave-call-200000')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-step-back'))
    expect(screen.queryByTestId('cue-wave-call-200000')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-step-back'))
    expect(marks()).toHaveLength(0)
    expect(screen.getByTestId('cues-step-back')).toBeDisabled()
  })

  it('offers + CALL in Manual, which puts a CALL at the playhead, while a click on the zoomed wave places nothing', async () => {
    setup({ activeCueFlow: 'manual' })
    await ready()
    seekStrip(128)
    clickDetail(300)
    expect(marks()).toHaveLength(0)
    const add = screen.getByTestId('cues-add-call')
    expect(add).toHaveTextContent('+ CALL')
    fireEvent.click(add)
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^cue-wave-hot-/)).toHaveLength(0)
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

  it('plays the cue preview with Space while working in the folded section, and leaves Space to the mini-player elsewhere', async () => {
    stubSound()
    const player = vi.fn<() => void>()
    const commands: Command[] = [
      { id: 'play', title: 'play', enabled: true, group: 'navigate', run: player },
    ]
    renderHook(() =>
      useKeyboardShortcuts({
        isMac: true,
        overlayOpen: false,
        paletteOpen: false,
        bindings: resolveBindings(),
        getCommands: () => commands,
        onTogglePalette: () => {},
        onEscape: () => {},
        onStepTrack: () => {},
      }),
    )
    setup()
    await ready()
    const outside = document.createElement('div')
    outside.tabIndex = 0
    outside.setAttribute('data-testid', 'track-row')
    document.body.appendChild(outside)
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    act(() => screen.getByTestId('cue-wave').focus())
    fireEvent.keyDown(document.activeElement ?? document.body, { key: ' ' })
    expect(audios).toHaveLength(1)
    expect(player).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: ' ' })
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
    act(() => outside.focus())
    fireEvent.keyDown(outside, { key: ' ' })
    expect(player).toHaveBeenCalledTimes(1)
    expect(audios).toHaveLength(1)
    outside.remove()
  })

  it('takes the focus into the section when its zoomed wave is pressed, without a ring around the editor', async () => {
    setup()
    await ready()
    const editor = screen.getByTestId('cues-editor')
    expect(editor).toHaveAttribute('tabindex', '-1')
    expect(editor.className).toContain('outline-none')
  })

  it('zooms the folded zoomed wave with the buttons in the row and goes back to 16 bars with the reset beside them, since a click on the wave now places', async () => {
    setup()
    await ready()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    fireEvent.mouseUp(window, { clientX: 128 })
    const width = () => screen.getByTestId('cue-wave-view').style.width
    expect(width()).toBe('8%')
    const row = within(screen.getByTestId('cues-folded-row'))
    fireEvent.click(row.getByTestId('cue-zoom-in'))
    expect(width()).toBe('4%')
    fireEvent.click(row.getByTestId('cue-zoom-reset'))
    expect(width()).toBe('8%')
  })
})
