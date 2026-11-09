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
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { Settings, SurcoGrid, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import type { Command, CueActions } from '../lib/commands'
import { autoMarkOf, resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { claimKeys, runKeyClaim } from '../lib/spaceClaim'
import { installApi } from '../test/api'
import { hoverTooltip } from '../test/tooltip'
import { CuesSection } from './CuesSection'

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]

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
  gridFingerprint: '',
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

function setup(
  settings: Partial<Settings> | null = null,
  read: TrackCues = READ,
  api: Partial<Api> = {},
  actionsRef?: { current: CueActions | null },
) {
  const rekordboxCueWaveDetail = vi.fn<Api['rekordboxCueWaveDetail']>(async () => null)
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => read),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueWaveDetail,
    ...api,
  })
  const onJumpBars = vi.fn<(bars: CueJumpBars) => void>()
  const onQuantize = vi.fn<(unit: CueQuantize) => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', ...settings }}>
        <CuesSection
          cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
          open
          onToggle={vi.fn()}
          track={TRACK}
          onJumpBars={onJumpBars}
          onQuantize={onQuantize}
          actionsRef={actionsRef}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { rekordboxCueWaveDetail, onJumpBars, onQuantize }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const maximize = async () => {
  await ready()
  fireEvent.click(screen.getByTestId('section-maximize'))
  await waitFor(() =>
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
  )
}
const seek = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 + 10 })
  fireEvent.mouseMove(window, { clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
}
const position = () => screen.getByTestId('cues-position').textContent

describe('CuesSection maximized', () => {
  it('keeps the deck and the full-size zoomed wave for full screen, the folded section showing its short one', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'false')
    expect(screen.getByTestId('cue-detail').style.height).toBe('96px')
    expect(screen.queryByTestId('cues-deck')).toBeNull()
  })

  it('offers no right-click menu on the folded strip, since corrections belong to the full editor', async () => {
    setup()
    await ready()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100 })
    expect(screen.queryByTestId('cues-menu')).toBeNull()
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

  it('puts the length, BPM and key in grey beside the title, and Guardar, the keys and restore on the same bar', async () => {
    setup()
    await maximize()
    const header = screen.getByTestId('cues-header')
    const meta = within(header).getByTestId('cues-meta')
    for (const id of ['cues-duration', 'cues-bpm', 'cues-key'])
      expect(meta).toContainElement(screen.getByTestId(id))
    for (const id of ['cues-save', 'cues-step-back', 'cues-keys', 'section-maximize'])
      expect(header).toContainElement(screen.getByTestId(id))
    expect(screen.getAllByTestId('section-maximize')).toHaveLength(1)
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-save')).toHaveTextContent('Save to rekordbox')
  })

  it('gathers what acts on the marks in one bar over the waves, the flow and Auto mark on the left and the time and the bars to the CALL on the right', async () => {
    setup()
    await maximize()
    const toolbar = screen.getByTestId('cues-toolbar')
    for (const id of ['cues-flow', 'cues-auto-mark', 'cues-position'])
      expect(toolbar).toContainElement(screen.getByTestId(id))
    expect(screen.getByTestId('cues-header')).not.toContainElement(screen.getByTestId('cues-flow'))
    expect(
      toolbar.compareDocumentPosition(screen.getByTestId('cue-wave')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('puts Jump and Q in the toolbar, so the deck fits one line', async () => {
    setup()
    await maximize()
    const toolbar = screen.getByTestId('cues-toolbar')
    const deck = screen.getByTestId('cues-deck')
    for (const id of ['cues-jump', 'cues-quantize']) {
      expect(toolbar).toContainElement(screen.getByTestId(id))
      expect(deck).not.toContainElement(screen.getByTestId(id))
    }
  })

  it('puts the zoom on the deck line right after Auto, so checking a grid fix up close never sends the hand up to the toolbar', async () => {
    setup()
    await maximize()
    const toolbar = screen.getByTestId('cues-toolbar')
    const deckGrid = screen.getByTestId('cues-deck-grid')
    for (const id of ['cue-zoom-out', 'cue-zoom-reset', 'cue-zoom-in']) {
      expect(deckGrid).toContainElement(screen.getByTestId(id))
      expect(toolbar).not.toContainElement(screen.getByTestId(id))
    }
    expect(
      screen
        .getByTestId('cues-grid-auto')
        .compareDocumentPosition(screen.getByTestId('cue-zoom-out')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hands the command palette Clear all only while the editor is full screen', async () => {
    const actionsRef: { current: CueActions | null } = { current: null }
    setup(null, { ...READ, cues: [{ id: 'h', ms: 64000, kind: 2, color: 1 }] }, {}, actionsRef)
    await ready()
    expect(actionsRef.current?.clearAll).toBeUndefined()
    await maximize()
    expect(actionsRef.current?.clearAll?.enabled).toBe(true)
    act(() => actionsRef.current?.clearAll?.run())
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    expect(document.activeElement).toBe(editor())
    expect(actionsRef.current?.clearAll?.enabled).toBe(false)
    expect(screen.getByTestId('cues-clear-all')).toBeDisabled()
  })

  it('puts Clear all alone at the far end of the deck line, after the zoom, so neither the ✕ of a CALL nor Auto mark sits beside it', async () => {
    setup(null, { ...READ, cues: [{ id: 'h', ms: 64000, kind: 2, color: 1 }] })
    await maximize()
    const clear = screen.getByTestId('cues-clear-all')
    expect(screen.getByTestId('cues-toolbar')).not.toContainElement(clear)
    expect(screen.queryByTestId('cues-more')).toBeNull()
    expect(screen.getByTestId('cues-deck')).toContainElement(clear)
    expect(clear).toHaveAccessibleName('Clear all cues')
    expect(
      screen.getByTestId('cue-zoom-in').compareDocumentPosition(clear) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByTestId('cues-memory-remove').nextElementSibling).toBeNull()
  })

  it('splits the deck line into play, pads, CALL, grid, zoom and Clear all with a divider between each', async () => {
    setup()
    await maximize()
    const deck = screen.getByTestId('cues-deck')
    const marks = [
      'cues-play',
      'cues-pad-A',
      'cues-memory',
      'cues-grid-bpm',
      'cue-zoom-out',
      'cues-clear-all',
    ].map((id) => screen.getByTestId(id))
    const dividers = within(deck).getAllByTestId('cues-deck-divider')
    expect(dividers).toHaveLength(5)
    dividers.forEach((divider, i) => {
      expect(
        marks[i].compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        divider.compareDocumentPosition(marks[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })
  })

  it('clears every hot cue and CALL but the loops from Clear all on the deck, and ⌘Z brings them back', async () => {
    const loop = { id: 'l', ms: 32000, kind: 1, color: 1, loop: true }
    setup(null, {
      ...READ,
      cues: [
        loop,
        { id: 'h', ms: 64000, kind: 2, color: 1 },
        { id: 'c', ms: 96000, kind: 0, color: 0 },
      ],
    })
    await maximize()
    const clear = screen.getByTestId('cues-clear-all')
    clear.focus()
    fireEvent.click(clear)
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    expect(screen.queryByTestId('cue-wave-call-96000')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
    expect(document.activeElement).toBe(editor())
    key('z', { metaKey: true })
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-call-96000')).toBeInTheDocument()
  })

  it('starts the work right under the track header, so the eye reads down from the title without a gap', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-toolbar').className).not.toContain('mt-auto')
    expect(screen.getByTestId('cues-deck').parentElement).toBe(screen.getByTestId('cues-editor'))
  })

  // The DJ reads the whole-track wave for where the grid sits, not rekordbox's phrase names,
  // so the row under it shows how far the grid is from the kick across the track.
  it('shows how the grid sits across the track right under the overview, in place of the phrase names', async () => {
    setup(
      null,
      {
        ...READ,
        sections: [
          { ms: 0, label: 'Intro', kind: 'intro' },
          { ms: 32000, label: 'Chorus', kind: 'chorus' },
        ],
      },
      { rekordboxGridFit: vi.fn<Api['rekordboxGridFit']>(async () => ({ bpm: 120, firstMs: 46 })) },
    )
    await maximize()
    const checks = await screen.findByTestId('cues-grid-windows')
    expect(screen.getByTestId('cue-wave').nextElementSibling).toBe(checks)
    expect(screen.queryByText('Chorus')).toBeNull()
  })

  // Measuring the fine wave decodes the whole file, so it waits for the view where the DJ zooms.
  it('asks for the fine wave once maximized, where the zoom needs it, and not in the folded section', async () => {
    const fine = vi.fn<Api['rekordboxCueWaveFine']>(async () => null)
    setup(null, READ, { rekordboxCueWaveFine: fine })
    await ready()
    expect(fine).not.toHaveBeenCalled()
    await maximize()
    await waitFor(() => expect(fine).toHaveBeenCalledWith('103'))
  })

  it('starts below the macOS window controls, so the cover and title never sit under the traffic lights', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-titlebar-inset')).toBeInTheDocument()
  })

  it('keeps the top bar at the top on Windows, where no traffic lights sit over it', async () => {
    setup(null, READ, { platform: 'win32' })
    await maximize()
    expect(screen.queryByTestId('cues-titlebar-inset')).toBeNull()
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

  it('asks main for the full colour wave as soon as the section is open, folded or full, since both draw the zoomed wave', async () => {
    const { rekordboxCueWaveDetail } = setup()
    await ready()
    await waitFor(() => expect(rekordboxCueWaveDetail).toHaveBeenCalledWith('103'))
  })

  it('moves the playhead with a click on the overview in Manual', async () => {
    setup({ activeCueFlow: 'manual' })
    await maximize()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 100 })
    fireEvent.mouseUp(window, { clientX: 100 })
    expect(position()).toBe('1:40.0')
    expect(screen.queryByTestId('cue-wave-call-100000')).toBeNull()
  })

  it('moves the playhead to the beat with a click on the overview with a flow chosen and places nothing, so the strip always navigates', async () => {
    setup()
    await maximize()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128.3 })
    fireEvent.mouseUp(window, { clientX: 128.3 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 128.3 })
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
    expect(position()).toBe('2:08.5')
    seek(100000)
    expect(position()).toBe('1:40.0')
  })

  it('shows on the overview the part the zoomed wave shows, and follows the zoom', async () => {
    setup()
    await maximize()
    seek(56000)
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('10%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('8%')
    editor().focus()
    key('+')
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('12%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('4%')
  })

  it('zooms with the buttons beside the zoomed wave as with the keys, and goes back to 16 bars with reset', async () => {
    setup()
    await maximize()
    seek(56000)
    fireEvent.click(screen.getByTestId('cue-zoom-in'))
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('4%')
    fireEvent.click(screen.getByTestId('cue-zoom-out'))
    fireEvent.click(screen.getByTestId('cue-zoom-out'))
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('16%')
    fireEvent.click(screen.getByTestId('cue-zoom-reset'))
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('8%')
    expect(screen.getByTestId('cue-zoom-reset')).toBeDisabled()
  })

  it('recolours a placed hot cue from its pad and puts the default colour back', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.click(within(screen.getByTestId('cues-pad-colours')).getByTestId('cue-palette-42'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ backgroundColor: '#e62828' })
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.click(within(screen.getByTestId('cues-pad-colours')).getByTestId('cue-palette-reset'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ backgroundColor: '#28e214' })
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
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain('16%')
    seek(200000)
    fireEvent.click(screen.getByTestId('cues-pad-B'))
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(position()).toBe('1:04.0')
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'false')
  })

  it('puts one CALL at the playhead with + CALL, walks the CALLs selecting each and deletes the selected one with ⌫', async () => {
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
    expect(screen.getByTestId('cue-wave-call-64000')).toHaveAttribute('data-selected', 'true')
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(position()).toBe('2:00.0')
    expect(screen.getByTestId('cue-wave-call-120000')).toHaveAttribute('data-selected', 'true')
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-call-120000')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
  })

  it('deletes with ⌫ the CALL + CALL just put on the beat when the playhead sat off the grid', async () => {
    setup()
    await maximize()
    seek(64200)
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
  })

  it('walks to a CALL from rekordbox off the grid with › and deletes it with ⌫', async () => {
    setup(null, { ...READ, cues: [{ id: 'r', ms: 64230, kind: 0, color: null }] })
    await maximize()
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(position()).toBe('1:04.2')
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-call-64230')).toBeNull()
  })

  it('deletes with the ✕ the CALL reached with ›, brings the focus back to the editor and restores it with ⌘Z', async () => {
    setup(null, { ...READ, cues: [{ id: 'r', ms: 64000, kind: 0, color: null }] })
    await maximize()
    seek(0)
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
    expect(document.activeElement).toBe(editor())
    key('z', { metaKey: true })
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
  })

  it('deletes with the ✕ the CALL under the playhead when nothing is selected', async () => {
    setup(null, { ...READ, cues: [{ id: 'r', ms: 64000, kind: 0, color: null }] })
    await maximize()
    seek(64000)
    expect(screen.getByTestId('cue-wave-call-64000')).not.toHaveAttribute('data-selected', 'true')
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
  })

  it('greys out the ✕ with no CALL there and leaves a hot cue alone', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cues-memory-remove')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
  })

  it('changes the jump from its menu and hands it on to be saved', async () => {
    const { onJumpBars } = setup()
    await maximize()
    expect(screen.getByTestId('cues-jump')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump'))
    fireEvent.click(screen.getByTestId('cues-jump-option-32'))
    expect(onJumpBars).toHaveBeenCalledWith(32)
  })

  it('gives the keys back to the editor after picking a jump size, so the arrows work without a click', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-jump'))
    fireEvent.click(screen.getByTestId('cues-jump-option-32'))
    expect(document.activeElement).toBe(editor())
    key('ArrowRight')
    expect(position()).toBe('0:32.0')
  })

  it('gives the keys back to the editor when the jump menu is closed with Escape', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-jump'))
    fireEvent.keyDown(screen.getByTestId('cues-jump-listbox'), { key: 'Escape' })
    expect(document.activeElement).toBe(editor())
  })

  it('changes the quantize from its Q menu, hands it on to be saved and gives the keys back to the editor', async () => {
    const { onQuantize } = setup()
    await maximize()
    expect(screen.getByTestId('cues-quantize')).toHaveTextContent('Bar')
    fireEvent.click(screen.getByTestId('cues-quantize'))
    fireEvent.click(screen.getByTestId('cues-quantize-option-beat'))
    expect(onQuantize).toHaveBeenCalledWith('beat')
    expect(document.activeElement).toBe(editor())
  })

  it('gives the keys back to the editor when the Q menu is closed with Escape, without restoring it', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-quantize'))
    fireEvent.keyDown(screen.getByTestId('cues-quantize-listbox'), { key: 'Escape' })
    expect(document.activeElement).toBe(editor())
    expect(editor()).toHaveAttribute('data-maximized', 'true')
  })

  it('shows the quantize set in Settings and draws the beats on the zoomed wave only then', async () => {
    setup({ cueQuantize: 'beat' })
    await maximize()
    expect(screen.getByTestId('cues-quantize')).toHaveTextContent('Beat')
    expect(screen.getAllByTestId('cue-detail-beat').length).toBeGreaterThan(0)
  })

  it('shows the jump set in Settings', async () => {
    setup({ cueJumpBars: 64 })
    await maximize()
    expect(screen.getByTestId('cues-jump')).toHaveTextContent('64 bars')
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

  // Enter is the key that places the flow and accepts the suggestions, and the list left it
  // out with redo and Esc; a key that does something and is not listed is never found.
  it('lists Enter, redo and Esc with the other keys', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-keys'))
    const legend = screen.getByTestId('cues-legend')
    expect(legend).toHaveTextContent('place the flow at the playhead, or accept the suggestions')
    expect(legend).toHaveTextContent('redo')
    expect(legend).toHaveTextContent('close the open menu')
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

  it('adds a hot cue at the playhead from an empty pad and letters it by its place in the track, while a pad whose letter is taken jumps to that cue, with the order on', async () => {
    setup()
    await maximize()
    seek(64000)
    key('2')
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain('16%')
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    seek(20000)
    key('1')
    expect(position()).toBe('1:04.0')
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(1)
    seek(20000)
    key('2')
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain('5%')
    expect(screen.getByTestId('cue-wave-hot-B').style.left).toContain('16%')
    key('2')
    expect(position()).toBe('1:04.0')
  })

  it('says on an empty pad which letter its cue will take, since with the letters in track order a cue placed before C becomes C and not the pad pressed', async () => {
    setup(
      { cueLettersByTime: true },
      {
        ...READ,
        cues: [
          { id: 'a', ms: 16000, kind: 1, color: 1 },
          { id: 'b', ms: 32000, kind: 2, color: 1 },
          { id: 'c', ms: 96000, kind: 3, color: 1 },
        ],
      },
    )
    await maximize()
    seek(64000)
    expect(hoverTooltip(screen.getByTestId('cues-pad-E'))).toBe('Places a cue here · it becomes C')
    seek(128000)
    expect(hoverTooltip(screen.getByTestId('cues-pad-E'))).toBe('Places a cue here · it becomes D')
  })

  it('leaves the empty pads unexplained when each letter is a fixed pad', async () => {
    setup({ cueLettersByTime: false })
    await maximize()
    expect(hoverTooltip(screen.getByTestId('cues-pad-E'))).toBeNull()
  })

  it('marks a track with the keyboard only', async () => {
    setup({ cueLettersByTime: false })
    await maximize()
    key('ArrowRight')
    expect(position()).toBe('0:32.0')
    key('m')
    expect(screen.getByTestId('cue-wave-call-32000')).toBeInTheDocument()
    key('ArrowRight')
    key('2')
    expect(screen.getByTestId('cue-wave-hot-B').style.left).toContain('16%')
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

  it('puts a CALL with M on the bar line by default, where the countdowns and drops of the flow sit', async () => {
    setup()
    await maximize()
    seek(64600)
    editor().focus()
    key('m')
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
    seek(129400)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain('32.5%')
  })

  it('puts a CALL with M on the beat when the quantize is the beat', async () => {
    setup({ cueQuantize: 'beat' })
    await maximize()
    seek(64600)
    editor().focus()
    key('m')
    expect(screen.getByTestId('cue-wave-call-64500')).toBeInTheDocument()
  })

  it('centres the playhead with C on the nearest bar line by default', async () => {
    setup()
    await maximize()
    seek(65500)
    editor().focus()
    key('c')
    expect(position()).toBe('1:06.0')
  })

  it('centres the playhead with C on the nearest beat when the quantize is the beat', async () => {
    setup({ cueQuantize: 'beat' })
    await maximize()
    seek(65500)
    editor().focus()
    key('c')
    expect(position()).toBe('1:05.5')
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

  it('zooms the zoomed wave with a pinch or ⌘ and the wheel', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.wheel(screen.getByTestId('cue-detail'), { deltaY: -60, ctrlKey: true })
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(9)
    fireEvent.wheel(screen.getByTestId('cue-detail'), { deltaY: 60, metaKey: true })
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(17)
  })

  it('shows the playhead time in the bar over the waves instead of in the top bar', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-header')).not.toContainElement(
      screen.getByTestId('cues-position'),
    )
    expect(screen.getByTestId('cues-toolbar')).toContainElement(screen.getByTestId('cues-position'))
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

  it('plays a LAME MP3 from the sound rekordbox places under the playhead, not one frame later', async () => {
    stubSound()
    const rekordboxAuditionLead = vi.fn<Api['rekordboxAuditionLead']>(async () => 26)
    setup(null, READ, { rekordboxAuditionLead })
    await maximize()
    await waitFor(() => expect(rekordboxAuditionLead).toHaveBeenCalledWith('103'))
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-play'))
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    expect(audios[0].currentTime).toBeCloseTo(63.974, 6)
  })

  it('plays and pauses with the Play button for whoever does not use the keyboard', async () => {
    stubSound()
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(audios).toHaveLength(1)
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Pause')
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(pause).toHaveBeenCalled()
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
  })

  it('lands the playhead on the beat when the overview is clicked, and restarts the audio from that beat while playing', async () => {
    stubSound()
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-play'))
    seek(65300)
    expect(position()).toBe('1:05.5')
    expect(audios[0].currentTime).toBe(65.5)
  })

  it('lets the playhead follow the playing audio freely instead of snapping it to a beat', async () => {
    stubSound()
    const frames: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb))
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-play'))
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    audios[0].currentTime = 70.123
    act(() => frames[frames.length - 1]())
    expect(position()).toBe('1:10.1')
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
  })

  it('stops the sound on restore even when the section stays mounted where it was, and keeps the track loaded for the next Play', async () => {
    stubSound()
    setup()
    await maximize()
    const section = screen.getByTestId('cues-section')
    key(' ')
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    pause.mockClear()
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(screen.getByTestId('cues-section')).toBe(section)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(audios[0].removeAttribute).not.toHaveBeenCalled()
  })

  it('lists the keys with the jump in use', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-keys'))
    expect(screen.getByTestId('cues-legend')).toHaveTextContent('jump 16 bars')
    expect(screen.getByTestId('cues-legend')).toHaveTextContent('⌘Z')
  })

  it('places the flow on the bar under a click on the zoomed wave without moving the playhead', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(screen.getByTestId('cue-wave-call-136000')).toBeInTheDocument()
    expect(position()).toBe('2:08.0')
  })

  it('draws the flow only at the pointer while it hovers the zoomed wave, nothing at rest, and Enter places it at the playhead', async () => {
    setup()
    await maximize()
    seek(128000)
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/)).toHaveLength(0)
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 300 })
    expect(screen.getByTestId('cue-detail-ghost-call-136000')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-ghost-call-136000')).toBeNull()
    expect(screen.getByTestId('cue-wave-cursor')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('cue-detail'))
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/)).toHaveLength(0)
    editor().focus()
    key('Enter')
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
  })

  it('draws no ghost while the strip is dragged, since the pointer is not where a click would place', async () => {
    setup()
    await maximize()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/)).toHaveLength(0)
    fireEvent.mouseMove(window, { clientX: 200 })
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/)).toHaveLength(0)
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
  })

  it('still plays with Space after a plain click on the zoomed wave, with a flow or in Manual', async () => {
    for (const mode of ['mine', 'manual']) {
      stubSound()
      setup({ activeCueFlow: mode })
      await maximize()
      seek(128000)
      fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 200 })
      fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
      fireEvent.mouseUp(window, { clientX: 200 })
      fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 220 })
      expect(key(' ')).toBe(false)
      expect(audios).toHaveLength(1)
      cleanup()
      resetEditorSections()
      resetCueSession()
    }
  })

  it('leaves the zoomed wave to the grab hand in Manual and places nothing with a click', async () => {
    setup({ activeCueFlow: 'manual' })
    await maximize()
    seek(128000)
    expect(screen.getByTestId('cue-detail').style.cursor).toBe('grab')
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(screen.queryByTestId('cue-wave-call-128000')).toBeNull()
  })

  it('gives the keys back to the editor after Manual is picked from the mode list, so M puts a CALL without a click', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-flow'))
    fireEvent.click(screen.getByTestId('cues-flow-option-manual'))
    expect(document.activeElement).toBe(editor())
    key('m')
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
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
      paletteOpen: false,
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

  it('changes track with ↑ ↓ Home End PageUp PageDown from the full editor, since each track keeps its draft', async () => {
    const { ran, release } = app()
    setup()
    await maximize()
    for (const k of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) key(k)
    release()
    expect(ran.mock.calls.map(([id]) => id)).toEqual([
      'prev',
      'next',
      'list-top',
      'list-bottom',
      'list-page-up',
      'list-page-down',
    ])
  })

  it('keeps the draft and the full editor when ↓ goes to the next track and ↑ comes back', async () => {
    const tracks = ['103', '104']
    installApi({
      rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (contentId) => ({
        ...READ,
        contentId,
      })),
      rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
      rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async () => null),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Player(): React.JSX.Element {
      const [at, setAt] = useState(0)
      useKeyboardShortcuts({
        isMac: true,
        overlayOpen: false,
        paletteOpen: false,
        bindings: resolveBindings(),
        getCommands: () => [
          { id: 'next', title: 'next', enabled: true, group: 'navigate', run: () => setAt(1) },
          { id: 'prev', title: 'prev', enabled: true, group: 'navigate', run: () => setAt(0) },
        ],
        onTogglePalette: () => {},
        onEscape: () => {},
        onStepTrack: () => {},
      })
      const contentId = tracks[at]
      return (
        <QueryClientProvider client={client}>
          <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
            <CuesSection
              cue={{ contentId, path: `/m/${contentId}.wav`, label: contentId }}
              open
              onToggle={vi.fn()}
              track={TRACK}
            />
          </SettingsProvider>
        </QueryClientProvider>
      )
    }
    render(<Player />)
    await maximize()
    key('m')
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
    key('ArrowDown')
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeDisabled())
    expect(screen.queryByTestId('cue-wave-call-0')).toBeNull()
    expect(editor()).toHaveAttribute('data-maximized', 'true')
    key('ArrowUp')
    await waitFor(() => expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument())
    expect(editor()).toHaveAttribute('data-maximized', 'true')
    expect(document.activeElement).toBe(editor())
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

  it('changes track with Ctrl+↑ ↓ but never runs ⌘⌫ ⌘↵ ⌘E on the list hidden under the editor', async () => {
    const { ran, release, onStepTrack } = app()
    setup()
    await maximize()
    key('m')
    key('ArrowDown', { ctrlKey: true })
    key('ArrowUp', { ctrlKey: true })
    expect(key('ArrowLeft', { metaKey: true })).toBe(false)
    expect(key('Backspace', { metaKey: true })).toBe(false)
    expect(key('Enter', { metaKey: true })).toBe(false)
    expect(key('e', { metaKey: true })).toBe(false)
    expect(key('Enter', { metaKey: true, shiftKey: true })).toBe(false)
    expect(key('t', { metaKey: true })).toBe(false)
    release()
    expect(onStepTrack.mock.calls).toEqual([[1], [-1]])
    expect(ran).not.toHaveBeenCalled()
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
  })

  it('changes track but never removes or processes it with the focus outside the full editor', async () => {
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
    expect(onStepTrack).toHaveBeenCalledWith(1)
    expect(new Set(ran.mock.calls.map(([id]) => id))).toEqual(
      new Set(['next', 'prev', 'list-top', 'list-bottom', 'list-page-up', 'list-page-down']),
    )
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
  it('shows a small ✕ on a set pad only while the pointer is over it, and it deletes that hot cue without selecting or playing the pad', async () => {
    setup({ cueLettersByTime: false })
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    seek(120000)
    fireEvent.click(screen.getByTestId('cues-pad-B'))
    expect(screen.queryByTestId('cues-pad-A-delete')).toBeNull()
    expect(screen.queryByTestId('cues-pad-C-delete')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cues-pad-A-delete')).toHaveAccessibleName('Delete hot cue A')
    expect(screen.queryByTestId('cues-pad-B-delete')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-pad-A-delete'))
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
    expect(position()).toBe('2:00.0')
    fireEvent.mouseLeave(screen.getByTestId('cues-pad-B'))
  })

  it('removes the CALL behind a hot cue with its ✕ as ⌫ does', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.mouseEnter(screen.getByTestId('cues-pad-A'))
    fireEvent.click(screen.getByTestId('cues-pad-A-delete'))
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
  })

  it('shows no ✕ on the pad of a loop', async () => {
    setup(null, {
      ...READ,
      cues: [{ id: 'l', ms: 64000, kind: 1, color: 42, loop: true }],
    })
    await maximize()
    fireEvent.mouseEnter(screen.getByTestId('cues-pad-A'))
    expect(screen.queryByTestId('cues-pad-A-delete')).toBeNull()
  })

  it('deletes the focused pad with ⌫ or Supr and not the selected cue', async () => {
    setup({ cueLettersByTime: false })
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    seek(120000)
    fireEvent.click(screen.getByTestId('cues-pad-B'))
    screen.getByTestId('cues-pad-A').focus()
    fireEvent.keyDown(screen.getByTestId('cues-pad-A'), { key: 'Delete' })
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
    screen.getByTestId('cues-pad-B').focus()
    fireEvent.keyDown(screen.getByTestId('cues-pad-B'), { key: 'Backspace' })
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
  })

  it('shows the ✕ beside a hot cue and a CALL in the zoomed wave on hover and deletes only that mark', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    seek(120000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.queryByTestId('cue-detail-delete')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('cue-detail-call-120000'))
    fireEvent.click(screen.getByTestId('cue-detail-delete'))
    expect(screen.queryByTestId('cue-wave-call-120000')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
  })

  it('deletes a hot cue from its right-click menu without starting a drag, and returns the focus', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { button: 2, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.mouseUp(window)
    fireEvent.contextMenu(screen.getByTestId('cue-wave-hot-A'), { clientX: 100, clientY: 5 })
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain('16%')
    expect(screen.queryByTestId('cues-menu-add-hot')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-menu-delete'))
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.queryByTestId('cues-menu')).toBeNull()
    expect(document.activeElement).toBe(editor())
  })

  it('deletes the CALL under a hot cue from the menu and keeps the hot cue', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cue-wave-hot-A'), { clientX: 100, clientY: 5 })
    fireEvent.click(screen.getByTestId('cues-menu-delete-call'))
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
  })

  it('offers no CALL deletion when no CALL sits under the hot cue', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cue-wave-hot-A'), { clientX: 100, clientY: 5 })
    expect(screen.queryByTestId('cues-menu-delete-call')).toBeNull()
  })

  it('recolours a hot cue from the menu', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cue-wave-hot-A'), { clientX: 100, clientY: 5 })
    fireEvent.click(screen.getByTestId('cues-menu-colour'))
    fireEvent.click(within(screen.getByTestId('cues-menu')).getByTestId('cue-palette-42'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ backgroundColor: '#e62828' })
    expect(screen.queryByTestId('cues-menu')).toBeNull()
  })

  it('offers only Borrar on a CALL', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.contextMenu(screen.getByTestId('cue-wave-call-64000'), { clientX: 100, clientY: 5 })
    expect(screen.queryByTestId('cues-menu-colour')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-menu-delete'))
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
  })

  it('opens the mark menu from the zoomed wave too', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cue-detail-hot-A'), { clientX: 200, clientY: 5 })
    fireEvent.click(screen.getByTestId('cues-menu-delete'))
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })

  it('closes the mark menu with Escape without restoring the maximized section', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cue-wave-hot-A'), { clientX: 100, clientY: 5 })
    fireEvent.keyDown(screen.getByTestId('cues-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('cues-menu')).toBeNull()
    expect(editor()).toHaveAttribute('data-maximized', 'true')
    expect(document.activeElement).toBe(editor())
  })

  it('deletes the selected cue with the Delete key as with Backspace', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    editor().focus()
    key('Delete')
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })
})

describe('CuesSection maximized placing', () => {
  it('places with a click on the zoomed wave but never with the strip, offers no Marcar aquí button and still marks at the playhead with Enter', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 100 })
    fireEvent.mouseUp(window, { clientX: 100 })
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
    expect(screen.queryByTestId('cues-mark-here')).toBeNull()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(screen.getByTestId('cue-wave-call-100000')).toBeInTheDocument()
    seek(160000)
    editor().focus()
    key('Enter')
    expect(screen.getByTestId('cue-wave-call-160000')).toBeInTheDocument()
  })
})

describe('CuesSection maximized undo', () => {
  it('offers the same undo button in the header right before Guardar en rekordbox, undoing one step', async () => {
    setup()
    await maximize()
    const undo = screen.getByTestId('cues-step-back')
    expect(screen.getByTestId('cues-actions')).toContainElement(undo)
    expect(undo.nextElementSibling).toBe(screen.getByTestId('cues-save'))
    expect(hoverTooltip(undo)).toEqual('Undo⌘Z')
    expect(undo).toBeDisabled()
    seek(128000)
    editor().focus()
    key('Enter')
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-step-back'))
    expect(screen.queryByTestId('cue-wave-call-128000')).toBeNull()
    editor().focus()
    key('z', { metaKey: true, shiftKey: true })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
  })

  it('fills Save to rekordbox once there is something to save, so the edits are not left unsaved by a button that looks off', async () => {
    setup()
    await maximize()
    const save = screen.getByTestId('cues-save')
    expect(save.className).not.toContain('bg-[var(--color-accent)]')
    seek(128000)
    editor().focus()
    key('Enter')
    expect(save).toBeEnabled()
    expect(save.className).toContain('bg-[var(--color-accent)]')
  })
})

describe('CuesSection maximized point corrections', () => {
  const placeAtPlayhead = () => {
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
  }
  const marks = () =>
    screen
      .queryAllByTestId(/^cue-wave-(hot|call)-/)
      .map((el) => `${el.dataset.testid} ${el.style.left}`)
      .sort()

  it('moves the point by dragging its CALL on the zoomed wave and redraws its flow there, undone in one step', async () => {
    setup()
    await maximize()
    seek(136000)
    placeAtPlayhead()
    const clean = marks()
    key('z', { metaKey: true })
    seek(128000)
    placeAtPlayhead()
    const before = marks()
    const call = screen.getByTestId('cue-detail-call-128000')
    fireEvent.mouseDown(call, { button: 0, clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(marks()).toEqual(clean)
    expect(position()).toBe('2:08.0')
    key('z', { metaKey: true })
    expect(marks()).toEqual(before)
  })

  it('counts to the point and lets only the point be dragged, not the countdown CALLs its flow generated', async () => {
    const calls: CueFlow = {
      id: 'calls16',
      name: 'CALLs',
      markPoint: true,
      rules: [
        {
          from: 'drop',
          direction: 'back',
          bars: 16,
          repeat: 2,
          when: 'always',
          place: 'call',
          color: { fixed: 1 },
        },
      ],
    }
    setup({ cueFlows: [...KEPT, calls], activeCueFlow: 'calls16' })
    await maximize()
    seek(128000)
    placeAtPlayhead()
    seek(80000)
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('24 bars to the CALL')
    expect(screen.getByTestId('cue-detail-call-96000').style.cursor).not.toBe('ew-resize')
    seek(120000)
    expect(screen.getByTestId('cue-detail-call-128000').style.cursor).toBe('ew-resize')
  })

  it('moves a hot cue with its CALL by dragging it on the zoomed wave, on the Quantize grid, undone in one step', async () => {
    setup()
    await maximize()
    seek(128000)
    placeAtPlayhead()
    const placed = marks()
    seek(96000)
    fireEvent.mouseDown(screen.getByTestId('cue-detail-hot-C'), { button: 0, clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 252 })
    fireEvent.mouseUp(window, { clientX: 252 })
    expect(screen.getByTestId('cue-wave-hot-C').style.left).toContain('25%')
    expect(screen.getByTestId('cue-wave-call-100000')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-call-96000')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(position()).toBe('1:36.0')
    key('z', { metaKey: true })
    expect(marks()).toEqual(placed)
  })

  it('hides the flow ghost while a point’s CALL is dragged and brings it back after', async () => {
    setup()
    await maximize()
    seek(128000)
    placeAtPlayhead()
    seek(120000)
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 100 })
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/).length).toBeGreaterThan(0)
    fireEvent.mouseDown(screen.getByTestId('cue-detail-call-128000'), { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 350 })
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/)).toHaveLength(0)
    fireEvent.mouseUp(window, { clientX: 350 })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 100 })
    expect(screen.queryAllByTestId(/^cue-(wave|detail)-ghost-/).length).toBeGreaterThan(0)
  })

  it('moves only the playhead when a drag on the strip starts on a mark, since the strip only navigates', async () => {
    setup()
    await maximize()
    seek(128000)
    placeAtPlayhead()
    const placed = marks()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-call-128000'), { button: 0, clientX: 128 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(marks()).toEqual(placed)
    expect(position()).toBe('3:20.0')
  })

  it('takes the point’s flow away with its CALL from the ✕, from ⌫ and from the menu, leaving nothing behind', async () => {
    setup()
    await maximize()
    seek(128000)
    const remove = [
      () => {
        fireEvent.mouseEnter(screen.getByTestId('cue-detail-call-128000'))
        fireEvent.click(screen.getByTestId('cue-detail-delete'))
      },
      () => {
        fireEvent.click(screen.getByTestId('cue-wave-call-128000'))
        editor().focus()
        key('Backspace')
      },
      () => {
        fireEvent.contextMenu(screen.getByTestId('cue-detail-call-128000'))
        fireEvent.click(screen.getByTestId('cues-menu-delete'))
      },
    ]
    for (const run of remove) {
      placeAtPlayhead()
      expect(marks().length).toBeGreaterThan(1)
      run()
      expect(marks()).toEqual([])
    }
  })
})

describe("CuesSection maximized on Surco's grid", () => {
  const SURCO: SurcoGrid = {
    bpm: 140,
    grid: Array.from({ length: 800 }, (_, i) => ({ ms: 37 + i * 500, beat: 0 })),
    words: Uint16Array.from({ length: 60000 }, () => 31 << 2),
  }
  const onSurcoGrid = (settings: Partial<Settings> | null = null) =>
    setup(
      settings,
      { ...READ, analysed: false, grid: [] },
      {
        rekordboxSurcoGrid: vi.fn<Api['rekordboxSurcoGrid']>(async () => SURCO),
      },
    )

  it('keeps Bar in the quantize menu but off, since only rekordbox can tell where a bar starts', async () => {
    onSurcoGrid({ cueQuantize: 'bar' })
    await maximize()
    expect(screen.getByTestId('cues-quantize')).toHaveTextContent('Beat')
    fireEvent.click(screen.getByTestId('cues-quantize'))
    expect(screen.getByTestId('cues-quantize-option-bar')).toHaveAttribute('aria-disabled', 'true')
  })

  it('proposes drops on the bars Surco hears in the bass, so Auto mark works before rekordbox analyses the track', async () => {
    const beatAt = (i: number) => 37 + i * 500
    const bassIn = (i: number) => i >= 130
    const words = Uint16Array.from({ length: 60000 }, (_, k) => {
      const beat = Math.floor((k / 0.15 - 37) / 500)
      return ((bassIn(beat) ? 7 : 1) << 13) | (20 << 2)
    })
    setup(
      null,
      { ...READ, analysed: false, grid: [] },
      {
        rekordboxSurcoGrid: vi.fn<Api['rekordboxSurcoGrid']>(async () => ({ ...SURCO, words })),
      },
    )
    await maximize()
    expect(screen.getByTestId('cues-auto-mark')).toBeEnabled()
    expect(screen.getByTestId('cues-auto-mark')).not.toHaveAttribute('title')
    fireEvent.click(screen.getByTestId('cues-auto-mark'))
    await waitFor(() => expect(autoMarkOf('103')?.kind).toBe('proposed'))
    const kept = autoMarkOf('103')
    expect(kept?.kind === 'proposed' && kept.proposals.map((p) => p.ms)).toEqual([beatAt(130)])
  })

  it("names Surco's grid in the editor header too", async () => {
    onSurcoGrid()
    await maximize()
    expect(
      within(screen.getByTestId('cues-header')).getByTestId('cues-provisional'),
    ).toHaveTextContent('Surco grid · 140.00 BPM')
  })
})

describe('CuesSection maximized grid', () => {
  const bars = () => screen.getAllByTestId('cue-detail-bar').map((b) => Number(b.dataset.ms))
  const fitAt = (firstMs: number) =>
    vi.fn<Api['rekordboxGridFit']>(async () => ({ bpm: 120, firstMs }))

  it('moves the drawn grid with the grid row and carries the cues on its beats along', async () => {
    setup({ cueLettersByTime: false })
    await maximize()
    key('ArrowRight')
    key('m')
    expect(bars()).toContain(32000)
    fireEvent.click(screen.getByTestId('cues-grid-right'))
    expect(bars()).toContain(32005)
    expect(bars()).not.toContain(32000)
    expect(screen.getByTestId('cue-wave-call-32005')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-call-32000')).not.toBeInTheDocument()
    expect(screen.getByTestId('cues-unsaved')).toBeInTheDocument()
  })

  it('moves the grid with option and the arrows, like the buttons', async () => {
    setup()
    await maximize()
    key('ArrowRight', { altKey: true })
    expect(bars()).toContain(2005)
    key('ArrowLeft', { altKey: true, shiftKey: true })
    expect(bars()).toContain(2004)
  })

  describe('pinning', () => {
    const pinned = async () => {
      setup(null, READ, { rekordboxGridFit: fitAt(46) })
      await maximize()
      await screen.findByTestId('cues-grid-windows')
      seek(30000)
    }

    // Aiming at the kick by eye was the slow part of fixing a grid: G puts the grid on the
    // kick the detector heard nearest the playhead.
    it('puts the grid on the kick nearest the playhead with G', async () => {
      await pinned()
      key('g')
      expect(bars()).toContain(30046)
      expect(bars()).not.toContain(30000)
      expect(screen.getByTestId('cues-grid-pin-30046')).toBeInTheDocument()
      expect(screen.getByTestId('cues-unsaved')).toBeInTheDocument()
    })

    it('pins with the button too, for whoever does not use the keyboard', async () => {
      await pinned()
      fireEvent.click(screen.getByTestId('cues-grid-pin'))
      expect(bars()).toContain(30046)
    })

    it('pins right at the playhead with shift, for a beat the detector misheard', async () => {
      await pinned()
      key('G', { shiftKey: true })
      expect(bars()).toContain(30000)
      expect(screen.getByTestId('cues-grid-pin-30000')).toBeInTheDocument()
    })

    it('leaves ⌘G alone', async () => {
      await pinned()
      key('g', { metaKey: true })
      expect(bars()).toContain(30000)
      expect(screen.queryAllByTestId(/^cues-grid-pin-\d/)).toHaveLength(0)
    })

    // A pin left over from a grid that ⌘Z took back would pull the next pin's tempo
    // from a beat that is no longer on the grid.
    it('forgets the pins once the grid they made is undone', async () => {
      await pinned()
      key('g')
      key('z', { metaKey: true })
      expect(bars()).toContain(30000)
      expect(screen.queryAllByTestId(/^cues-grid-pin-\d/)).toHaveLength(0)
    })
  })

  it('puts a moved grid back with ⌘Z', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-grid-right'))
    key('z', { metaKey: true })
    expect(bars()).toContain(2000)
  })

  it('opens a grid with two tempos as two zones, flagging where the second begins, so the DJ work is kept', async () => {
    const twoTempos = [
      ...Array.from({ length: 400 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 })),
      ...Array.from({ length: 400 }, (_, i) => ({ ms: 200000 + i * 450, beat: (i % 4) + 1 })),
    ]
    setup(null, { ...READ, grid: twoTempos })
    await maximize()
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByTestId('cue-wave-anchor-200450')).toBeInTheDocument()
  })

  it('greys out the grid row with its reason on a grid too irregular for zones', async () => {
    const drifting = Array.from({ length: 800 }, (_, i) => ({
      ms: i * 500 + (i % 2) * 9,
      beat: (i % 4) + 1,
    }))
    setup(null, { ...READ, grid: drifting })
    await maximize()
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(hoverTooltip(screen.getByTestId('cues-grid'))).toEqual(expect.stringMatching(/tempo/i))
  })

  it('greys out the grid row on a track rekordbox has not analysed, since there is no grid to write yet', async () => {
    setup(
      null,
      { ...READ, analysed: false, grid: [] },
      {
        rekordboxSurcoGrid: vi.fn<Api['rekordboxSurcoGrid']>(async () => ({
          bpm: 120,
          grid: GRID.map((b) => ({ ...b, beat: 0 })),
          words: null,
        })),
      },
    )
    await maximize()
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(hoverTooltip(screen.getByTestId('cues-grid'))).toEqual(expect.stringMatching(/analy/i))
  })

  it('gives each grid offset a fixed width, so a value going from +1 ms to −12 ms never shoves the grid buttons sideways', async () => {
    setup(null, READ, { rekordboxGridFit: fitAt(454) })
    await maximize()
    await waitFor(() => expect(screen.getByTestId('cues-grid-here')).toBeInTheDocument())
    for (const id of ['cues-grid-here', 'cues-grid-end']) {
      const value = screen.getByTestId(id)
      expect(value.style.minWidth).toBe('7ch')
      expect(value.style.display).toBe('inline-block')
    }
  })

  it('shows how far the grid is from the beats here and at the end, and Auto fits it', async () => {
    setup(null, READ, { rekordboxGridFit: fitAt(454) })
    await maximize()
    await waitFor(() => expect(screen.getByTestId('cues-grid-here')).toHaveTextContent('+46 ms'))
    expect(screen.getByTestId('cues-grid-end')).toHaveTextContent('+46 ms')
    expect(screen.getByTestId('cues-grid-auto')).toHaveAttribute('data-needs-fix', 'true')
    fireEvent.click(screen.getByTestId('cues-grid-auto'))
    expect(screen.getByTestId('cues-grid-here')).toHaveTextContent('0 ms')
    expect(screen.getByTestId('cues-grid-auto')).not.toHaveAttribute('data-needs-fix')
  })

  it('carries the cues onto the beats Auto fits, since cues set on a late grid fire late in the booth', async () => {
    setup({ cueLettersByTime: false }, READ, { rekordboxGridFit: fitAt(454) })
    await maximize()
    key('ArrowRight')
    key('m')
    expect(screen.getByTestId('cue-wave-call-32000')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cues-grid-auto')).toBeEnabled())
    fireEvent.click(screen.getByTestId('cues-grid-auto'))
    expect(bars()).toContain(31954)
    expect(screen.getByTestId('cue-wave-call-31954')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-offgrid')).not.toBeInTheDocument()
    key('z', { metaKey: true })
    expect(bars()).toContain(32000)
    expect(screen.getByTestId('cue-wave-call-32000')).toBeInTheDocument()
  })

  it('keeps Auto calm when the grid already sits within the tolerance', async () => {
    setup(null, READ, { rekordboxGridFit: fitAt(5) })
    await maximize()
    await waitFor(() => expect(screen.getByTestId('cues-grid-here')).toHaveTextContent('−5 ms'))
    expect(screen.getByTestId('cues-grid-auto')).not.toHaveAttribute('data-needs-fix')
  })

  it('keeps a moved grid while another track is open and undoes it on return', async () => {
    installApi({
      rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) => ({
        ...READ,
        contentId: id,
      })),
      rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
      rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async () => null),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (contentId: string) => (
      <QueryClientProvider client={client}>
        <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
          <CuesSection
            cue={{ contentId, path: `/m/${contentId}.wav`, label: contentId }}
            open
            onToggle={vi.fn()}
            track={TRACK}
          />
        </SettingsProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(tree('103'))
    await maximize()
    fireEvent.click(screen.getByTestId('cues-grid-right'))
    rerender(tree('104'))
    await waitFor(() => expect(bars()).toContain(2000))
    rerender(tree('103'))
    await waitFor(() => expect(bars()).toContain(2005))
    key('z', { metaKey: true })
    expect(bars()).toContain(2000)
  })

  it('keeps the grid on the deck line beside the pads and how far it sits from the beats beside the time, so the deck fits one line', async () => {
    setup(null, READ, { rekordboxGridFit: fitAt(454) })
    await maximize()
    await waitFor(() => expect(screen.getByTestId('cues-grid-here')).toBeInTheDocument())
    const deck = screen.getByTestId('cues-deck')
    for (const id of ['cues-grid', 'cues-grid-bpm', 'cues-pad-A'])
      expect(deck).toContainElement(screen.getByTestId(id))
    const toolbar = screen.getByTestId('cues-toolbar')
    for (const id of ['cues-grid-here', 'cues-grid-end'])
      expect(toolbar).toContainElement(screen.getByTestId(id))
    expect(screen.queryByTestId('cues-grid-strip')).toBeNull()
  })

  it('has no grid row in the small editor', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-grid')).toBeNull()
  })

  it('draws the program grid exactly as it is on a track nobody touched, not one rebuilt from its tempo', async () => {
    const jittered = GRID.map((b) => (b.ms === 2000 ? { ...b, ms: 2001 } : b))
    setup(null, { ...READ, grid: jittered })
    await maximize()
    expect(bars()).toContain(2001)
    expect(bars()).not.toContain(2000)
  })

  it('shows the grid rekordbox has now when the DJ comes back to a track with only cue changes, never the old one', async () => {
    const rekordboxTrackCues = vi.fn<Api['rekordboxTrackCues']>(async (id) => ({
      ...READ,
      contentId: id,
    }))
    installApi({
      rekordboxTrackCues,
      rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
      rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async () => null),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (contentId: string) => (
      <QueryClientProvider client={client}>
        <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
          <CuesSection
            cue={{ contentId, path: `/m/${contentId}.wav`, label: contentId }}
            open
            onToggle={vi.fn()}
            track={TRACK}
          />
        </SettingsProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(tree('103'))
    await maximize()
    key('m')
    rerender(tree('104'))
    await waitFor(() => expect(screen.getByTestId('cues-grid')).toBeInTheDocument())
    rekordboxTrackCues.mockImplementation(async (id) => ({
      ...READ,
      contentId: id,
      grid: GRID.map((b) => ({ ...b, ms: b.ms + 100 })),
    }))
    client.removeQueries({ queryKey: ['rekordbox-track-cues', '103'] })
    rerender(tree('103'))
    await waitFor(() => expect(bars()).toContain(2100))
    expect(bars()).not.toContain(2000)
  })

  it('gives the keys back to the editor when the BPM menu closes, so Space plays at once', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    const input = screen.getByTestId('cues-grid-bpm-input')
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.activeElement).toBe(editor())
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true')
  })

  it('saves the moved grid with the fingerprint of the grid it was read from', async () => {
    const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
    setup(null, { ...READ, gridFingerprint: 'g0' }, { saveRekordboxCues })
    await maximize()
    fireEvent.click(screen.getByTestId('cues-grid-right'))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(saveRekordboxCues.mock.calls[0][0][0]).toMatchObject({
      grid: { bpm: 120, anchorMs: 5 },
      gridFingerprint: 'g0',
    })
  })

  it('saves a cue-only change without any grid', async () => {
    const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
    setup(null, { ...READ, gridFingerprint: 'g0' }, { saveRekordboxCues })
    await maximize()
    key('m')
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(saveRekordboxCues.mock.calls[0][0][0].grid).toBeUndefined()
  })

  it('shows the grid waiting in the queue for rekordbox to close, as the grid it will write, without calling it unsaved', async () => {
    setup(null, READ, {
      rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => ({
        wanted: [],
        fingerprint: READ.fingerprint,
        grid: { bpm: 120, anchorMs: 1 },
      })),
    })
    await maximize()
    await waitFor(() => expect(bars()).toContain(2001))
    expect(screen.queryByTestId('cues-unsaved')).toBeNull()
  })

  it('re-sends a queued grid with the fingerprint it was queued on, so a grid moved in rekordbox since is still refused', async () => {
    const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
    setup(
      null,
      { ...READ, gridFingerprint: 'g-now' },
      {
        saveRekordboxCues,
        rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => ({
          wanted: [],
          fingerprint: READ.fingerprint,
          grid: { bpm: 120, anchorMs: 1 },
          gridFingerprint: 'g-queued',
        })),
      },
    )
    await maximize()
    await waitFor(() => expect(bars()).toContain(2001))
    key('m')
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(saveRekordboxCues.mock.calls[0][0][0]).toMatchObject({
      grid: { bpm: 120, anchorMs: 1 },
      gridFingerprint: 'g-queued',
    })
  })

  it('keeps a fixed slot over the overview for the off-grid and Auto mark bars, so one showing or going never shoves the waves', async () => {
    const offBeat = { ...READ, cues: [{ id: 'c1', ms: 31986, kind: 0, color: null }] }
    setup(null, offBeat)
    await maximize()
    const slot = screen.getByTestId('cues-notices')
    expect(slot.style.minHeight).toBe('36px')
    expect(slot).toContainElement(screen.getByTestId('cues-offgrid'))
    fireEvent.click(screen.getByTestId('cues-offgrid-snap'))
    expect(screen.queryByTestId('cues-offgrid')).toBeNull()
    expect(screen.getByTestId('cues-notices').style.minHeight).toBe('36px')
  })

  it('names the cue that misses its beat, jumps to it and brings it onto the beat', async () => {
    const offBeat = { ...READ, cues: [{ id: 'c1', ms: 31986, kind: 0, color: null }] }
    setup(null, offBeat)
    await maximize()
    expect(screen.getByTestId('cues-offgrid')).toHaveTextContent('14 ms')
    fireEvent.click(screen.getByTestId('cues-offgrid-go-31986'))
    expect(position()).toBe('0:31.9')
    fireEvent.click(screen.getByTestId('cues-offgrid-snap'))
    expect(screen.getByTestId('cue-wave-call-32000')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-offgrid')).toBeNull()
    key('z', { metaKey: true })
    expect(screen.getByTestId('cue-wave-call-31986')).toBeInTheDocument()
  })

  it('also names it in the small editor, where the filter sends the DJ first', async () => {
    setup(null, { ...READ, cues: [{ id: 'c1', ms: 31986, kind: 0, color: null }] })
    await ready()
    expect(screen.getByTestId('cues-offgrid')).toBeInTheDocument()
  })

  it('says nothing for a cue inside the tolerance', async () => {
    setup(null, { ...READ, cues: [{ id: 'c1', ms: 31994, kind: 0, color: null }] })
    await ready()
    expect(screen.queryByTestId('cues-offgrid')).toBeNull()
  })

  it('paints the cues that miss their beat apart on both waves, so they are found at a glance', async () => {
    setup(null, {
      ...READ,
      cues: [
        { id: 'c1', ms: 31986, kind: 0, color: null },
        { id: 'h1', ms: 31986, kind: 1, color: 42 },
        { id: 'c2', ms: 64000, kind: 0, color: null },
      ],
    })
    await maximize()
    fireEvent.click(screen.getByTestId('cues-offgrid-go-31986'))
    expect(screen.getByTestId('cue-wave-call-31986')).toHaveAttribute('data-off-grid', 'true')
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-off-grid', 'true')
    expect(screen.getByTestId('cue-wave-call-64000')).toHaveAttribute('data-off-grid', 'false')
    expect(screen.getByTestId('cue-detail-call-31986')).toHaveAttribute('data-off-grid', 'true')
    expect(screen.getByTestId('cue-detail-hot-A')).toHaveAttribute('data-off-grid', 'true')
  })

  it('moves the grid instead of the cues when they all miss their beat by the same amount', async () => {
    setup(null, {
      ...READ,
      cues: [
        { id: 'c1', ms: 32108, kind: 0, color: null },
        { id: 'c2', ms: 64105, kind: 0, color: null },
      ],
    })
    await maximize()
    fireEvent.click(screen.getByTestId('cues-offgrid-shift-grid'))
    expect(screen.queryByTestId('cues-offgrid')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-32108')).toBeInTheDocument()
    expect(screen.getByTestId('cues-unsaved')).toBeInTheDocument()
  })

  it('offers only to move the cues in the small editor, where the grid is not edited', async () => {
    setup(null, {
      ...READ,
      cues: [
        { id: 'c1', ms: 32108, kind: 0, color: null },
        { id: 'c2', ms: 64105, kind: 0, color: null },
      ],
    })
    await ready()
    expect(screen.getByTestId('cues-offgrid')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-offgrid-shift-grid')).toBeNull()
  })

  it('opens a zone at the playhead and moves only that zone, flagging where it starts on both waves', async () => {
    setup()
    await maximize()
    key('ArrowRight')
    fireEvent.click(screen.getByTestId('cues-grid-anchor'))
    expect(screen.getByTestId('cue-wave-anchor-32000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-detail-anchor-32000')).toBeInTheDocument()
    key('ArrowRight', { altKey: true })
    expect(bars()).toContain(32005)
    key('ArrowLeft')
    expect(bars()).toContain(2000)
    expect(bars()).not.toContain(2005)
  })
})
