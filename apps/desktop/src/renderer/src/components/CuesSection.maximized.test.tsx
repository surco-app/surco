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
import type { CueJumpBars } from '../../../shared/cueJump'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import type { Command } from '../lib/commands'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { claimKeys, runKeyClaim } from '../lib/spaceClaim'
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

function setup(settings: Partial<Settings> | null = null, read: TrackCues = READ) {
  const rekordboxCueWaveDetail = vi.fn<Api['rekordboxCueWaveDetail']>(async () => null)
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => read),
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
    expect(screen.getByTestId('cues-duration')).toHaveTextContent('6:40')
    expect(screen.getByTestId('cues-bpm')).toHaveTextContent('120 BPM')
    expect(screen.getByTestId('cues-key')).toHaveTextContent('6A')
    expect(position()).toBe('0:00.0')
    expect(screen.queryByTestId('cues-remaining')).toBeNull()
    expect(screen.getByTestId('cue-detail')).toBeInTheDocument()
    expect(screen.getByTestId('cues-deck')).toBeInTheDocument()
    expect(screen.getByTestId('cues-save')).toBeInTheDocument()
  })

  it('puts the length, BPM and key in grey beside the title and the main action, Guardar, the keys and restore on the same bar', async () => {
    setup()
    await maximize()
    const header = screen.getByTestId('cues-header')
    const meta = within(header).getByTestId('cues-meta')
    for (const id of ['cues-duration', 'cues-bpm', 'cues-key'])
      expect(meta).toContainElement(screen.getByTestId(id))
    for (const id of ['cues-apply-flow', 'cues-flow', 'cues-save', 'cues-keys', 'section-maximize'])
      expect(header).toContainElement(screen.getByTestId(id))
    expect(screen.getAllByTestId('section-maximize')).toHaveLength(1)
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-save')).toHaveTextContent('Save to rekordbox')
  })

  it('keeps the restore button when the track cannot be edited, so the full editor is never a dead end', async () => {
    setup(null, { ...READ, analysed: false, grid: [] })
    await waitFor(() => expect(screen.getByTestId('cues-unanalysed')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no selection row in the full editor, where the pads and ⌫ do its work', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(screen.queryByTestId('cues-selection')).toBeNull()
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
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

  it('recolours a placed hot cue from its pad and puts the default colour back', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.click(within(screen.getByTestId('cues-pad-colours')).getByTestId('cue-palette-42'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#e62828' })
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.click(within(screen.getByTestId('cues-pad-colours')).getByTestId('cue-palette-reset'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#28e214' })
  })

  it('gives the keys back to the editor after a pad colour, Restablecer or Escape, so Space plays and not the pad', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    const colours = () => within(screen.getByTestId('cues-pad-colours'))
    const pickFrom = (id: string) => {
      const button = colours().getByTestId(id)
      button.focus()
      fireEvent.click(button)
    }
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    pickFrom('cue-palette-42')
    expect(document.activeElement).toBe(editor())
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    pickFrom('cue-palette-reset')
    expect(document.activeElement).toBe(editor())
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    colours().getByTestId('cue-palette-42').focus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
    expect(document.activeElement).toBe(editor())
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

  it('removes with ✕ the CALL MEMORY just put on the beat when the playhead sat off the grid', async () => {
    setup()
    await maximize()
    seek(64200)
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
  })

  it('still removes with ✕ a CALL from rekordbox that sits off the grid under the playhead', async () => {
    setup(null, { ...READ, cues: [{ id: 'r', ms: 64230, kind: 0, color: null }] })
    await maximize()
    seek(64230)
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.queryByTestId('cue-wave-call-64230')).toBeNull()
  })

  it('disables ✕ while no CALL sits at the playhead, so a click never looks like it did nothing', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-memory-remove')).toBeDisabled()
    seek(64200)
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.getByTestId('cues-memory-remove')).toBeEnabled()
    seek(100000)
    expect(screen.getByTestId('cues-memory-remove')).toBeDisabled()
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

  it('keeps the key list out of the way until its keyboard button asks for it, so the editor stays compact', async () => {
    setup()
    await maximize()
    expect(screen.queryByTestId('cues-legend')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-keys'))
    expect(screen.getByTestId('cues-legend')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-keys'))
    expect(screen.queryByTestId('cues-legend')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-keys'))
    fireEvent.mouseDown(screen.getByTestId('cue-detail'))
    expect(screen.queryByTestId('cues-legend')).toBeNull()
  })

  it('closes the key list on Escape without restoring the full editor and gives the keys back to it', async () => {
    setup()
    await maximize()
    const windowKeys = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', windowKeys)
    fireEvent.click(screen.getByTestId('cues-keys'))
    fireEvent.keyDown(screen.getByTestId('cues-legend'), { key: 'Escape' })
    window.removeEventListener('keydown', windowKeys)
    expect(screen.queryByTestId('cues-legend')).toBeNull()
    expect(windowKeys).not.toHaveBeenCalled()
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true')
    expect(document.activeElement).toBe(screen.getByTestId('cues-editor'))
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

const play = vi.fn<() => Promise<void>>()
const pause = vi.fn<() => void>()
const audios: {
  onloadedmetadata: (() => void) | null
  currentTime: number
  removeAttribute: (name: string) => void
}[] = []

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

const editor = () => screen.getByTestId('cues-editor')
const key = (k: string, mods: Record<string, boolean> = {}) =>
  fireEvent.keyDown(document.activeElement ?? editor(), { key: k, ...mods })

describe('CuesSection maximized keys', () => {
  it('takes the focus when maximized so the keys work at once', async () => {
    setup()
    await maximize()
    expect(document.activeElement).toBe(editor())
  })

  it('marks a track with the keyboard only', async () => {
    setup()
    await maximize()
    key('ArrowRight')
    expect(position()).toBe('0:32.0')
    key('m')
    expect(screen.getByTestId('cue-wave-call-32000')).toBeInTheDocument()
    key('ArrowRight')
    key('2')
    expect(screen.getByTestId('cue-wave-hot-B').style.left).toBe('16%')
    key('ArrowLeft', { shiftKey: true })
    expect(position()).toBe('1:03.5')
    key('ArrowRight', { shiftKey: true })
    key('ArrowLeft')
    key('2')
    expect(position()).toBe('1:04.0')
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    key('z', { metaKey: true })
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
  })

  it('centres the playhead on the nearest beat with C', async () => {
    setup()
    await maximize()
    seek(64200)
    editor().focus()
    key('c')
    expect(position()).toBe('1:04.0')
  })

  it('jumps the bars set in Settings', async () => {
    setup({ cueJumpBars: 32 })
    await maximize()
    key('ArrowRight')
    expect(position()).toBe('1:04.0')
  })

  it('zooms the detail with + and −', async () => {
    setup()
    await maximize()
    seek(64000)
    editor().focus()
    key('+')
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(9)
    key('-')
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(17)
  })

  it('never acts while a field of the editor has the focus', async () => {
    setup()
    await maximize()
    const flow = screen.getByTestId('cues-flow')
    flow.focus()
    fireEvent.keyDown(flow, { key: 'm' })
    fireEvent.keyDown(flow, { key: 'ArrowRight' })
    expect(screen.queryByTestId('cue-wave-call-0')).toBeNull()
    expect(position()).toBe('0:00.0')
  })

  it('never acts while the flow list is open and an option has the focus', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-flow'))
    const option = screen.getByTestId('cues-flow-option-mine')
    option.focus()
    fireEvent.keyDown(option, { key: 'm' })
    fireEvent.keyDown(option, { key: 'ArrowRight' })
    expect(screen.queryByTestId('cue-wave-call-0')).toBeNull()
    expect(position()).toBe('0:00.0')
  })

  it('swallows other single keys so a hidden section never acts under the full editor', async () => {
    setup()
    await maximize()
    expect(fireEvent.keyDown(editor(), { key: 'q' })).toBe(false)
    expect(fireEvent.keyDown(editor(), { key: 'a' })).toBe(false)
    expect(fireEvent.keyDown(editor(), { key: 'Escape' })).toBe(true)
    expect(fireEvent.keyDown(editor(), { key: 'k', metaKey: true })).toBe(true)
  })

  it('keeps today’s keys only while folded', async () => {
    setup()
    await ready()
    expect(fireEvent.keyDown(editor(), { key: 'm' })).toBe(true)
    expect(screen.queryByTestId('cue-wave-call-0')).toBeNull()
  })

  it('Space plays the track from the playhead and never reaches the floating player', async () => {
    stubSound()
    const shared = document.body.appendChild(document.createElement('audio'))
    const pauseShared = vi.fn()
    shared.pause = pauseShared
    setup()
    await maximize()
    seek(64000)
    editor().focus()
    expect(key(' ')).toBe(false)
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    expect(audios[0].currentTime).toBe(64)
    expect(play).toHaveBeenCalled()
    expect(pauseShared).toHaveBeenCalled()
    key(' ')
    expect(pause).toHaveBeenCalled()
    shared.remove()
  })

  it('plays with Space after a click left the focus on a pad, instead of pressing the pad again', async () => {
    stubSound()
    setup()
    await maximize()
    const pad = screen.getByTestId('cues-pad-A')
    pad.focus()
    fireEvent.click(pad)
    expect(key(' ')).toBe(false)
    expect(audios).toHaveLength(1)
  })

  it('answers the global Space while maximized even with the focus elsewhere', async () => {
    stubSound()
    setup()
    await maximize()
    let handled = false
    act(() => {
      handled = runKeyClaim('play')
    })
    expect(handled).toBe(true)
    expect(audios).toHaveLength(1)
  })

  it('keeps Space and Trim’s keys when Click repair or Trim claim again under the full editor', async () => {
    stubSound()
    setup()
    await maximize()
    const declickPlay = vi.fn<() => void>()
    const trimBack = vi.fn<() => void>()
    const release = claimKeys({ play: declickPlay, 'trim-start-back': trimBack })
    act(() => {
      runKeyClaim('play')
      runKeyClaim('trim-start-back')
    })
    release()
    expect(audios).toHaveLength(1)
    expect(declickPlay).not.toHaveBeenCalled()
    expect(trimBack).not.toHaveBeenCalled()
  })

  it('stops the sound when the section is restored to its place', async () => {
    stubSound()
    setup()
    await maximize()
    key(' ')
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(pause).toHaveBeenCalled()
    expect(runKeyClaim('play')).toBe(false)
  })

  it('stops the sound on restore even when the section stays mounted where it was', async () => {
    stubSound()
    setup()
    await maximize()
    const section = screen.getByTestId('cues-section')
    key(' ')
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(screen.getByTestId('cues-section')).toBe(section)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(audios[0].removeAttribute).toHaveBeenCalledWith('src')
  })

  it('lists the keys with the jump in use', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-keys'))
    expect(screen.getByTestId('cues-legend')).toHaveTextContent('jump 16 bars')
    expect(screen.getByTestId('cues-legend')).toHaveTextContent('⌘Z')
  })

  it('marks where it drops with the main button and one click on the overview, applying the flow, instead of moving the playhead', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    seek(128000)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(position()).toBe('0:00.0')
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    seek(100000)
    expect(position()).toBe('1:40.0')
  })

  it('marks where it drops with a click on the zoomed wave while waiting, without scrubbing it', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 100 })
    fireEvent.mouseUp(window, { clientX: 100 })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(position()).toBe('2:08.0')
  })

  it('marks where it drops at the playhead with M while waiting, and applies the flow', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    key('m')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
  })

  it('stops waiting with Escape without restoring the full editor, and the overview seeks again', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    const windowKeys = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', windowKeys)
    fireEvent.keyDown(editor(), { key: 'Escape' })
    window.removeEventListener('keydown', windowKeys)
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    expect(windowKeys).not.toHaveBeenCalled()
    expect(editor()).toHaveAttribute('data-maximized', 'true')
    expect(document.activeElement).toBe(editor())
    seek(100000)
    expect(position()).toBe('1:40.0')
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })
})

const LIST_COMMANDS = [
  'next',
  'prev',
  'list-top',
  'list-bottom',
  'list-page-down',
  'list-page-up',
  'remove',
  'process-current',
  'clear-meta',
  'process-all',
  'derive-tags',
]

function app() {
  const ran = vi.fn<(id: string) => void>()
  const commands: Command[] = LIST_COMMANDS.map((id) => ({
    id,
    title: id,
    enabled: true,
    group: 'navigate',
    run: () => ran(id),
  }))
  const trim = {
    'trim-start-back': vi.fn<() => void>(),
    'trim-start-clear': vi.fn<() => void>(),
    'trim-end-clear': vi.fn<() => void>(),
    'trim-end-zoom-out': vi.fn<() => void>(),
  }
  const release = claimKeys(trim)
  const onStepTrack = vi.fn<(dir: -1 | 1) => void>()
  renderHook(() =>
    useKeyboardShortcuts({
      isMac: true,
      overlayOpen: false,
      bindings: resolveBindings(),
      getCommands: () => commands,
      onTogglePalette: () => {},
      onEscape: () => {},
      onStepTrack,
    }),
  )
  return { ran, trim, release, onStepTrack }
}

describe('CuesSection maximized over the rest of the editor', () => {
  it('keeps . and , from moving Trim’s end cut hidden under the full editor', async () => {
    const { trim, release } = app()
    setup()
    await maximize()
    expect(key('.')).toBe(false)
    expect(key(',')).toBe(false)
    release()
    expect(trim['trim-end-clear']).not.toHaveBeenCalled()
    expect(trim['trim-end-zoom-out']).not.toHaveBeenCalled()
  })

  it('never changes track with ↑ ↓ Home End PageUp PageDown, so the unsaved cues stay', async () => {
    const { ran, release } = app()
    setup()
    await maximize()
    key('m')
    for (const k of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
      expect(key(k)).toBe(false)
    release()
    expect(ran).not.toHaveBeenCalled()
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
  })

  it('leaves ↓ to the track list while folded, as today', async () => {
    const { ran, release } = app()
    setup()
    await ready()
    editor().focus()
    fireEvent.keyDown(editor(), { key: 'ArrowDown' })
    release()
    expect(ran).toHaveBeenCalledWith('next')
  })

  it('never changes track with Ctrl+↑ ↓ nor runs ⌘⌫ ⌘↵ ⌘E on the list hidden under the editor, so the unsaved cues stay', async () => {
    const { ran, release, onStepTrack } = app()
    setup()
    await maximize()
    key('m')
    expect(key('ArrowDown', { ctrlKey: true })).toBe(false)
    expect(key('ArrowUp', { ctrlKey: true })).toBe(false)
    expect(key('ArrowLeft', { metaKey: true })).toBe(false)
    expect(key('Backspace', { metaKey: true })).toBe(false)
    expect(key('Enter', { metaKey: true })).toBe(false)
    expect(key('e', { metaKey: true })).toBe(false)
    expect(key('Enter', { metaKey: true, shiftKey: true })).toBe(false)
    expect(key('t', { metaKey: true })).toBe(false)
    release()
    expect(onStepTrack).not.toHaveBeenCalled()
    expect(ran).not.toHaveBeenCalled()
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
  })

  it('never changes track nor removes it from the list with the focus outside the full editor', async () => {
    const { ran, release, onStepTrack } = app()
    setup()
    await maximize()
    key('m')
    editor().blur()
    expect(document.activeElement).toBe(document.body)
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown', 'j'])
      fireEvent.keyDown(document.body, { key: k })
    fireEvent.keyDown(document.body, { key: 'ArrowDown', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'Backspace', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'e', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 't', metaKey: true })
    release()
    expect(onStepTrack).not.toHaveBeenCalled()
    expect(ran).not.toHaveBeenCalled()
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
  })

  it('leaves Ctrl+↓ and ⌘⌫ to the track list while folded, as today', async () => {
    const { ran, release, onStepTrack } = app()
    setup()
    await ready()
    fireEvent.keyDown(document.body, { key: 'ArrowDown', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    fireEvent.keyDown(document.body, { key: 'Backspace', metaKey: true })
    release()
    expect(onStepTrack).toHaveBeenCalledWith(1)
    expect(ran).toHaveBeenCalledWith('next')
    expect(ran).toHaveBeenCalledWith('remove')
  })

  it('keeps Trim’s keys from a hidden cut even with the focus outside the full editor', async () => {
    const { trim, release } = app()
    setup()
    await maximize()
    editor().blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'q' })
    fireEvent.keyDown(document.body, { key: 'z' })
    fireEvent.keyDown(document.body, { key: '.' })
    fireEvent.keyDown(document.body, { key: ',' })
    release()
    for (const handler of Object.values(trim)) expect(handler).not.toHaveBeenCalled()
  })
})
