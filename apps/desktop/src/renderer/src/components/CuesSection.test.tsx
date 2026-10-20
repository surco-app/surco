// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]

import { cueChanges, validWantedSet, type WantedCue } from '../../../shared/cueRules'
import type { QueuedCues, Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)
afterEach(resetCueSession)
afterEach(resetEditorSections)

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

function setup(
  read: TrackCues | null | Error = READ,
  queued: QueuedCues | null | Error = null,
  settings?: Partial<Settings>,
) {
  const logError = vi.fn<Api['logError']>()
  const onFlow = vi.fn<(id: string) => void>()
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
  const tree = (
    current: Partial<Settings> | null,
    cue = { contentId: '103', path: '/m/g.wav', label: 'Gowan' },
  ) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', ...current }}>
        <CuesSection cue={cue} open onToggle={vi.fn()} onFlow={onFlow} />
      </SettingsProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(settings ?? null))
  return {
    changeSettings: (next: Partial<Settings>) => rerender(tree(next)),
    changeTrack: (cue: { contentId: string; path: string; label: string }) =>
      rerender(tree(settings ?? null, cue)),
    logError,
    onFlow,
    saveRekordboxCues,
    undoRekordboxCues,
    rekordboxTrackCues,
    rekordboxQueuedCues,
    client,
  }
}

const clickAt = (ms: number) =>
  fireEvent.click(screen.getByTestId('cue-wave'), { clientX: ms / 1000, clientY: 60 })
const markAt = (ms: number) => {
  const full = screen.getByTestId('cues-editor').dataset.maximized === 'true'
  if (full) {
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 })
    fireEvent.mouseUp(window, { clientX: ms / 1000 })
  } else clickAt(ms)
  fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
  fireEvent.mouseUp(window, { clientX: 200 })
  if (!full) fireEvent.click(screen.getByTestId('section-maximize'))
}
const openFull = async () => {
  fireEvent.click(screen.getByTestId('section-maximize'))
  await waitFor(() =>
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
  )
}
const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const pick = (testId: string, ms: number) =>
  fireEvent.click(screen.getByTestId(testId), { clientX: ms / 1000 })

const writtenPlan = (): WantedCue[] => {
  const outcome = cueChanges(
    [],
    [bar(64)],
    [],
    GRID.map((g) => g.ms),
    [],
  )
  if (outcome.status !== 'plan') throw new Error('expected a plan')
  return outcome.changes.insert
}

function chooseFlow(id: string): void {
  fireEvent.click(screen.getByTestId('cues-flow'))
  fireEvent.click(screen.getByTestId(`cues-flow-option-${id}`))
}

describe('CuesSection', () => {
  it('opens the flow list outside the section so the editor column never cuts it off', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-flow'))
    expect(screen.getByTestId('cues-section')).not.toContainElement(
      screen.getByTestId('cues-flow-listbox'),
    )
  })

  it('keeps the unsaved cues when the section is mounted again in another place, as maximizing does', async () => {
    setup()
    await ready()
    markAt(bar(64))
    cleanup()
    setup()
    await ready()
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
  })

  it('starts from rekordbox again after Descartar cambios, even once the section is mounted again', async () => {
    setup()
    await ready()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
    cleanup()
    setup()
    await ready()
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })

  it('draws the countdown of the active flow live after marking a drop', async () => {
    setup()
    await ready()
    markAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
  })

  it('uses the flow chosen in Settings, one cue at 32 bars with no CALL under it', async () => {
    setup(READ, null, { activeCueFlow: 'one-at-32' })
    await ready()
    markAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(32) / 400000) * 100}%`,
    )
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    expect(screen.queryByTestId(`cue-wave-call-${bar(32)}`)).toBeNull()
  })

  it('saves the whole wanted set with the fingerprint it read', async () => {
    const { saveRekordboxCues } = setup()
    await ready()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const req = saveRekordboxCues.mock.calls[0][0]
    expect(req).toMatchObject({
      contentId: '103',
      path: '/m/g.wav',
      label: 'Gowan',
      fingerprint: 'f0',
    })
    expect(req.wanted.filter((c) => c.kind !== 0).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(16), 1, 42],
      [bar(32), 2, 22],
      [bar(48), 3, 1],
    ])
  })

  it('keeps Save off while the draft is what rekordbox or the queued save already holds', async () => {
    setup({ ...READ, cues: [{ id: 'd', ms: bar(64), kind: 0, color: null }] })
    await ready()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('deletes the selected hot cue and its CALL with the button or the backspace key', async () => {
    setup()
    await ready()
    markAt(bar(64))
    pick('cue-wave-hot-C', bar(48))
    fireEvent.click(screen.getByTestId('cues-delete'))
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(screen.queryByTestId(`cue-wave-call-${bar(48)}`)).toBeNull()
    pick('cue-wave-hot-B', bar(32))
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'Backspace' })
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
  })

  it('undoes the last change with cmd Z without letting the metadata undo see the key', async () => {
    setup()
    await ready()
    markAt(bar(64))
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    screen.getByTestId('cue-wave').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
  })

  it('clears every cue but the loops from the flow menu, keeps the flow, and cmd Z restores', async () => {
    const loop = { id: 'l', ms: bar(32), kind: 1, color: 1, loop: true }
    setup({ ...READ, cues: [loop, { id: 'h', ms: bar(64), kind: 2, color: 1 }] })
    await ready()
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-flow'))
    fireEvent.click(screen.getByTestId('cues-flow-option-clear-cues'))
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
    expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: My flow')
    expect(screen.getByTestId('cues-undo')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'z', metaKey: true })
    await waitFor(() => expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument())
  })

  it('disables the clear item when the draft has no cue to remove', async () => {
    setup({ ...READ, cues: [{ id: 'l', ms: bar(32), kind: 1, color: 1, loop: true }] })
    await ready()
    fireEvent.click(screen.getByTestId('cues-flow'))
    expect(screen.getByTestId('cues-flow-option-clear-cues')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    fireEvent.click(screen.getByTestId('cues-flow-option-clear-cues'))
    expect(screen.queryByTestId('cues-undo')).toBeNull()
  })

  it('recolours a hot cue from rekordbox picker', async () => {
    setup()
    await ready()
    markAt(bar(64))
    pick('cue-wave-hot-A', bar(16))
    expect(screen.queryByTestId('cue-palette')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-colour'))
    fireEvent.click(screen.getByTestId('cue-palette-5'))
    expect(screen.queryByTestId('cue-palette')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#50b4ff' })
    expect(screen.queryByTestId('cues-letter')).toBeNull()
  })

  it('shows no colour for a selected CALL, since rekordbox lets neither change', async () => {
    setup()
    await ready()
    markAt(bar(64))
    pick(`cue-wave-call-${bar(64)}`, bar(64))
    expect(screen.getByTestId('cues-delete')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-colour')).toBeNull()
  })

  it('floats the colour picker over the editor and closes it with Escape without leaving the section', async () => {
    setup()
    await ready()
    markAt(bar(64))
    pick('cue-wave-hot-A', bar(16))
    fireEvent.click(screen.getByTestId('cues-colour'))
    expect(screen.getByTestId('cues-colour-popover').className).toContain('absolute')
    const reachedWindow = vi.fn()
    window.addEventListener('keydown', reachedWindow)
    fireEvent.keyDown(document, { key: 'Escape' })
    window.removeEventListener('keydown', reachedWindow)
    expect(screen.queryByTestId('cue-palette')).toBeNull()
    expect(reachedWindow).not.toHaveBeenCalled()
  })

  it('closes the floating colour picker on a click outside it', async () => {
    setup()
    await ready()
    markAt(bar(64))
    pick('cue-wave-hot-A', bar(16))
    fireEvent.click(screen.getByTestId('cues-colour'))
    fireEvent.mouseDown(screen.getByTestId('cues-delete'))
    expect(screen.queryByTestId('cues-colour-popover')).toBeNull()
  })

  it('adds a hot cue from the right-click menu on the first free letter in the default colour', async () => {
    setup()
    await ready()
    await openFull()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(10) / 1000, clientY: 30 })
    fireEvent.click(screen.getByTestId('cues-menu-add-hot'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#28e214' })
    expect(screen.queryByTestId('cues-menu')).toBeNull()
  })

  it('marks a drop from the menu and adds a lone CALL from the menu', async () => {
    setup()
    await ready()
    await openFull()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(64) / 1000, clientY: 30 })
    expect(screen.getByTestId('cues-menu-mark-drop')).toHaveTextContent('Place the flow here')
    fireEvent.click(screen.getByTestId('cues-menu-mark-drop'))
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), {
      clientX: bar(100) / 1000,
      clientY: 30,
    })
    fireEvent.click(screen.getByTestId('cues-menu-add-call'))
    expect(screen.getByTestId(`cue-wave-call-${bar(100)}`)).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-hot-D')).toBeNull()
  })

  it('closes the menu with Escape or a click elsewhere without adding anything', async () => {
    setup()
    await ready()
    await openFull()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(10) / 1000, clientY: 30 })
    expect(screen.getByTestId('cues-menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('cues-menu')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(10) / 1000, clientY: 30 })
    expect(screen.getByTestId('cues-menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cues-menu')).toBeNull()
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })

  it('offers no hot cue in the menu once the 8 letters are taken', async () => {
    const full = [1, 2, 3, 5, 6, 7, 8, 9].map((kind, i) => ({
      id: `h${kind}`,
      ms: bar(10 + i * 10),
      kind,
      color: 1,
    }))
    setup({ ...READ, cues: full })
    await ready()
    await openFull()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(5) / 1000, clientY: 30 })
    expect(screen.getByTestId('cues-menu-add-hot')).toBeDisabled()
  })

  it('puts the strip first and the actions under it while folded, with a short Guardar', async () => {
    setup()
    await ready()
    const order = screen
      .getByTestId('cue-wave')
      .compareDocumentPosition(screen.getByTestId('cues-actions'))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('cues-actions')).toContainElement(screen.getByTestId('cues-flow'))
    expect(screen.getByTestId('cues-actions')).toContainElement(screen.getByTestId('cues-save'))
    expect(screen.getByTestId('cues-save').textContent).toBe('Save')
    expect(screen.getByTestId('cues-save')).toHaveAccessibleName('Save to rekordbox')
  })

  it('offers Descartar only once there is something to discard', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-undo')).toBeNull()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(screen.queryByTestId('cues-undo')).toBeNull())
  })

  it('does not take the drop away when the click that adds another lands on it', async () => {
    setup()
    await ready()
    markAt(bar(64))
    markAt(bar(64))
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
  })

  it('places with the flow picked from the list before anything is placed', async () => {
    setup()
    await ready()
    await openFull()
    chooseFlow('one-at-32')
    markAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(32) / 400000) * 100}%`,
    )
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
  })

  it('applies another flow to the drops already marked', async () => {
    setup()
    await ready()
    markAt(bar(64))
    chooseFlow('calls-only')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
  })

  it('follows a flow chosen in Settings while the editor is open, keeping the draft and using it for the next drop', async () => {
    const { changeSettings } = setup(READ, null, { activeCueFlow: 'mine' })
    await ready()
    markAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    changeSettings({ activeCueFlow: 'one-at-32' })
    await waitFor(() =>
      expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: One cue at 32'),
    )
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    markAt(bar(160))
    expect(screen.queryByTestId('cues-manual')).toBeNull()
    expect(
      screen
        .getAllByTestId(/^cue-wave-hot-/)
        .some((el) => el.style.left.includes(`${(bar(128) / 400000) * 100}%`)),
    ).toBe(true)
  })

  it('shows the bundled flow in the flow list once the flow picked there is deleted in Settings', async () => {
    const { changeSettings } = setup()
    await ready()
    chooseFlow('calls-only')
    changeSettings({ cueFlows: [MY_FLOW, ONE_AT_32] })
    await waitFor(() =>
      expect(screen.getByTestId('cues-flow')).toHaveAttribute('aria-label', 'Flow: One cue at 32'),
    )
  })

  it('lists only the bundled flow for a new DJ, already chosen', async () => {
    setup(READ, null, { cueFlows: undefined, activeCueFlow: undefined })
    await ready()
    expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: One cue at 32')
    fireEvent.click(screen.getByTestId('cues-flow'))
    const names = within(screen.getByTestId('cues-flow-listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['One cue at 32', 'Manual', 'Clear all cues'])
  })

  it('names the bundled flows in the flow list instead of showing them blank', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-flow'))
    const names = within(screen.getByTestId('cues-flow-listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['My flow', 'One cue at 32', 'CALL only', 'Manual', 'Clear all cues'])
  })

  it('reads Flujo and the flow name on the selector, lists Manual apart after the flows and saves the pick', async () => {
    const { onFlow } = setup()
    await ready()
    const trigger = screen.getByTestId('cues-flow')
    expect(within(trigger).getByText('Flow')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('Flow: My flow')
    fireEvent.click(trigger)
    expect(screen.getAllByTestId('cues-flow-separator')[0].nextElementSibling).toBe(
      screen.getByTestId('cues-flow-option-manual'),
    )
    fireEvent.click(screen.getByTestId('cues-flow-option-manual'))
    expect(onFlow).toHaveBeenCalledWith('manual')
    expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: Manual')
  })

  it('opens the full editor from a folded click with a flow chosen and says Haz clic para colocar only there, where a click places', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    clickAt(bar(64))
    await waitFor(() =>
      expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
    )
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
    expect(screen.getByTestId('cues-place-hint')).toHaveTextContent('Click to place')
    expect(screen.queryByTestId('cues-apply-flow')).toBeNull()
    markAt(bar(64))
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
  })

  it('takes the whole placement away with one ⌘Z', async () => {
    setup()
    await ready()
    markAt(bar(64))
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'z', metaKey: true })
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
  })

  it('opens the full editor from a folded click in Manual and places nothing, with no hint', async () => {
    setup(READ, null, { activeCueFlow: 'manual' })
    await ready()
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    clickAt(bar(64))
    await waitFor(() =>
      expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
    )
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
  })

  it('places a second point with a second click, each with its own cues', async () => {
    setup(READ, null, { activeCueFlow: 'one-at-32' })
    await ready()
    markAt(bar(64))
    markAt(bar(160))
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-call-${bar(160)}`)).toBeInTheDocument()
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(2)
  })

  it('places a flow that leaves the point unmarked without a CALL there, and a second click places again', async () => {
    const quiet: CueFlow = { ...ONE_AT_32, id: 'quiet', markPoint: false }
    setup(READ, null, { cueFlows: [MY_FLOW, quiet], activeCueFlow: 'quiet' })
    await ready()
    markAt(bar(64))
    markAt(bar(160))
    expect(screen.queryByTestId(`cue-wave-call-${bar(64)}`)).toBeNull()
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(2)
  })

  it('changes nothing when another flow is picked on a marked track until Aplicar a esta pista', async () => {
    setup()
    await ready()
    markAt(bar(64))
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
    chooseFlow('one-at-32')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.getByTestId('cues-apply-track')).toHaveTextContent('Apply to this track')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(32) / 400000) * 100}%`,
    )
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
  })

  it('offers Aplicar a esta pista with Mi flujo already active on a track rekordbox holds with lone CALLs, and draws the countdown with it', async () => {
    setup({
      ...READ,
      cues: [bar(64), bar(160)].map((ms, i) => ({ id: `d${i}`, ms, kind: 0, color: null })),
    })
    await ready()
    expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: My flow')
    expect(screen.queryAllByTestId(/^cue-wave-hot-/)).toHaveLength(0)
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.getAllByTestId(/^cue-wave-hot-/).length).toBeGreaterThan(0)
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
  })

  it('hides Aplicar a esta pista on a track where applying the active flow changes nothing', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
  })

  it('offers Aplicar a esta pista at once for a flow that does not depend on the point, and no hint to click', async () => {
    const chorus: CueFlow = {
      id: 'chorus',
      name: 'Estribillos',
      markPoint: false,
      rules: [
        {
          from: 'chorus',
          direction: 'back',
          bars: 0,
          repeat: 1,
          when: 'always',
          place: 'hot',
          color: { fixed: 5 },
        },
      ],
    }
    setup(
      {
        ...READ,
        phrases: [
          { ms: bar(64), kind: 'chorus' },
          { ms: bar(128), kind: 'chorus' },
        ],
      },
      null,
      { cueFlows: [MY_FLOW, chorus], activeCueFlow: 'chorus' },
    )
    await ready()
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(2)
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
  })

  const marks = (re: RegExp) =>
    screen
      .queryAllByTestId(re)
      .map((el) => `${el.dataset.testid?.replace('ghost-', '')} ${el.style.left}`)
      .sort()
  const hoverAt = (ms: number) =>
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: ms / 1000, clientY: 40 })

  it('draws on hover what a click would place with Mi flujo, see-through, and the click places exactly that', async () => {
    setup()
    await ready()
    hoverAt(bar(64))
    const shown = marks(/^cue-wave-ghost-(hot|call)-/)
    expect(shown).toHaveLength(7)
    expect(marks(/^cue-wave-(hot|call)-/)).toEqual([])
    markAt(bar(64))
    expect(marks(/^cue-wave-(hot|call)-/)).toEqual(shown)
    expect(marks(/^cue-wave-ghost-/)).toEqual([])
  })

  it('draws only the CALL of the point and the hot cue 32 bars before with Una cue a 32', async () => {
    setup(READ, null, { activeCueFlow: 'one-at-32' })
    await ready()
    hoverAt(bar(64))
    expect(
      screen
        .queryAllByTestId(/^cue-wave-ghost-/)
        .map((el) => el.dataset.testid)
        .sort(),
    ).toEqual([`cue-wave-ghost-call-${bar(64)}`, 'cue-wave-ghost-hot-A'])
  })

  it('draws dimmed and dashed what the flow drops at the hovered point and says why, so a lone hot cue is no mystery', async () => {
    setup({ ...READ, strong: [{ start: bar(30), end: bar(40) }] })
    await ready()
    hoverAt(bar(64))
    for (const ms of [bar(32), bar(16)])
      expect(screen.getByTestId(`cue-wave-ghost-dropped-${ms}`)).toHaveStyle({
        borderStyle: 'dashed',
        opacity: '0.3',
      })
    expect(screen.getByTestId('cues-rejected')).toHaveTextContent(
      "2 don't fit, they fall in the strong part",
    )
    fireEvent.mouseLeave(screen.getByTestId('cue-wave'))
    expect(screen.queryByTestId('cues-rejected')).toBeNull()
    expect(screen.queryAllByTestId(/^cue-wave-ghost-dropped-/)).toHaveLength(0)
    await openFull()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: bar(40) / 1000 })
    fireEvent.mouseUp(window, { clientX: bar(40) / 1000 })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 200 })
    expect(screen.getByTestId('cues-rejected')).toHaveTextContent(
      "1 doesn't fit, it falls before the first beat",
    )
  })

  it('says what does not fit only while the cursor is over the wave, not all the time on a track that could take the flow', async () => {
    setup({
      ...READ,
      strong: [{ start: bar(30), end: bar(40) }],
      cues: [bar(64), bar(160)].map((ms, i) => ({ id: `d${i}`, ms, kind: 0, color: null })),
    })
    await ready()
    expect(screen.getByTestId('cues-apply-track')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-rejected')).toBeNull()
    hoverAt(bar(66))
    expect(screen.getByTestId('cues-rejected')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('cue-wave'))
    expect(screen.queryByTestId('cues-rejected')).toBeNull()
  })

  it('draws what another flow would drop when it is chosen on a marked track, with the reason', async () => {
    setup({ ...READ, strong: [{ start: bar(30), end: bar(40) }] })
    await ready()
    markAt(bar(64))
    chooseFlow('one-at-32')
    expect(screen.getByTestId(`cue-wave-ghost-dropped-${bar(32)}`)).toBeInTheDocument()
    expect(screen.getByTestId('cues-rejected')).toHaveTextContent(
      "1 doesn't fit, it falls in the strong part",
    )
  })

  it('never offers Aplicar a esta pista for a flow that would only take hot cues away, and says it does not fit and why', async () => {
    setup({ ...READ, strong: [{ start: bar(30), end: bar(40) }] })
    await ready()
    markAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
    chooseFlow('one-at-32')
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
    expect(screen.getByTestId('cues-no-fit')).toHaveTextContent("This flow doesn't fit this track")
    expect(screen.getByTestId('cues-rejected')).toHaveTextContent(
      "1 doesn't fit, it falls in the strong part",
    )
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
  })

  it('still offers Aplicar a esta pista when the other flow places a hot cue, or places only CALLs by design, even if it takes hot cues away', async () => {
    setup()
    await ready()
    markAt(bar(64))
    for (const id of ['one-at-32', 'calls-only']) {
      chooseFlow(id)
      expect(screen.getByTestId('cues-apply-track')).toBeInTheDocument()
      expect(screen.queryByTestId('cues-no-fit')).toBeNull()
    }
  })

  it('draws no flow and no cursor in Manual', async () => {
    setup(READ, null, { activeCueFlow: 'manual' })
    await ready()
    hoverAt(bar(64))
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
  })

  it('dims what another flow would take away and draws what it would add, changing nothing until Aplicar a esta pista', async () => {
    setup()
    await ready()
    markAt(bar(64))
    chooseFlow('one-at-32')
    expect(screen.getByTestId('cue-wave-hot-C')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-wave-ghost-hot-A')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toHaveAttribute('data-pending', 'true')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
  })

  it('dims the CALL the first flow paired with a hot cue the new flow keeps, and Aplicar a esta pista leaves what a fresh placement would', async () => {
    setup()
    await ready()
    markAt(bar(64))
    chooseFlow('one-at-32')
    expect(screen.getByTestId(`cue-wave-call-${bar(32)}`)).toHaveAttribute('data-gone', 'true')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(
      screen
        .queryAllByTestId(/^cue-wave-(hot|call)-/)
        .map((el) => el.dataset.testid)
        .sort(),
    ).toEqual([`cue-wave-call-${bar(64)}`, 'cue-wave-hot-A'])
  })

  it('places a new point with the flow picked but not applied and leaves the points already marked, still offering Aplicar a esta pista', async () => {
    setup()
    await ready()
    markAt(bar(64))
    chooseFlow('one-at-32')
    const before = marks(/^cue-wave-(hot|call)-/)
    hoverAt(bar(160))
    expect(screen.queryAllByTestId(/^cue-wave-/).some((el) => el.dataset.gone === 'true')).toBe(
      false,
    )
    const shown = marks(/^cue-wave-ghost-(hot|call)-/)
    markAt(bar(160))
    expect(marks(/^cue-wave-(hot|call)-/)).toEqual([...before, ...shown].sort())
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-call-${bar(32)}`)).toBeInTheDocument()
    expect(screen.getByTestId('cues-apply-track')).toBeInTheDocument()
  })

  it('brings the flow switch back once the cursor leaves the strip, after the hover drew its own', async () => {
    setup()
    await ready()
    markAt(bar(64))
    chooseFlow('one-at-32')
    hoverAt(bar(160))
    expect(screen.getByTestId(`cue-wave-ghost-call-${bar(160)}`)).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('cue-wave'))
    expect(screen.queryByTestId(`cue-wave-ghost-call-${bar(160)}`)).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-C')).toHaveAttribute('data-gone', 'true')
  })

  it('explains only what a selected cue still lets the user do, since its letter is no longer changed here', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('section-help')).toHaveTextContent(
      'Select a cue to move it, delete it or change its colour.',
    )
  })

  it('forgets the hovered point when Settings switches to Manual under the cursor, so switching back draws no old flow', async () => {
    const { changeSettings } = setup()
    await ready()
    hoverAt(bar(64))
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/).length).toBeGreaterThan(0)
    changeSettings({ activeCueFlow: 'manual' })
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
    changeSettings({ activeCueFlow: 'mine' })
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
  })

  it('draws the whole result of a flow that does not depend on the point as soon as it is chosen', async () => {
    const chorus: CueFlow = {
      id: 'chorus',
      name: 'Estribillos',
      markPoint: false,
      rules: [
        {
          from: 'chorus',
          direction: 'back',
          bars: 0,
          repeat: 1,
          when: 'always',
          place: 'hot',
          color: { fixed: 5 },
        },
      ],
    }
    setup(
      {
        ...READ,
        phrases: [
          { ms: bar(64), kind: 'chorus' },
          { ms: bar(128), kind: 'chorus' },
        ],
      },
      null,
      { cueFlows: [MY_FLOW, chorus], activeCueFlow: 'chorus' },
    )
    await ready()
    expect(screen.queryAllByTestId(/^cue-wave-ghost-hot-/)).toHaveLength(2)
    expect(screen.queryAllByTestId(/^cue-wave-hot-/)).toHaveLength(0)
  })

  it('saves only sets main accepts, even after turning a written countdown into CALLs', async () => {
    const read: TrackCues = {
      ...READ,
      cues: writtenPlan().map((c, i) => ({ id: `w${i}`, ...c })),
    }
    const { saveRekordboxCues } = setup(read)
    await ready()
    chooseFlow('calls-only')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const { wanted } = saveRekordboxCues.mock.calls[0][0]
    expect(wanted.every((c) => c.kind === 0 && c.color === null)).toBe(true)
    expect(validWantedSet(wanted, read.cues)).toEqual({ ok: true })
  })

  it('says hand-placed hot cues stay as they are and only adds the CALL', async () => {
    setup({ ...READ, cues: [{ id: 'm', ms: bar(40), kind: 1, color: 1 }] })
    await ready()
    markAt(bar(64))
    expect(screen.getByTestId('cues-manual')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
  })

  it('says which hot cues the 8 limit leaves out', async () => {
    setup({
      ...READ,
      cues: [48, 96, 144, 192].map((n) => ({ id: `d${n}`, ms: bar(n), kind: 0, color: null })),
    })
    await ready()
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.getByTestId('cues-trimmed')).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-trimmed-${bar(0)}`)).toBeInTheDocument()
  })

  it('goes back to what rekordbox holds with Descartar cambios', async () => {
    const { undoRekordboxCues } = setup()
    await ready()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
    expect(undoRekordboxCues).not.toHaveBeenCalled()
  })

  it('starts from a queued save and drops it with Descartar cambios', async () => {
    const queued = { wanted: [{ ms: bar(64), kind: 0, color: null }], fingerprint: 'f0' }
    const { undoRekordboxCues, rekordboxQueuedCues } = setup(READ, queued)
    await ready()
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    rekordboxQueuedCues.mockResolvedValue(null)
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(undoRekordboxCues).toHaveBeenCalledWith('103'))
    await waitFor(() => expect(screen.queryByTestId(`cue-wave-call-${bar(64)}`)).toBeNull())
  })

  it('starts from what rekordbox holds when the queued save was built on an older read, so a cue added in rekordbox since is never deleted', async () => {
    const extra = { id: 'x', ms: bar(100), kind: 1, color: 1 }
    const { saveRekordboxCues } = setup(
      { ...READ, fingerprint: 'f2', cues: [extra] },
      { wanted: [{ ms: bar(64), kind: 0, color: null }], fingerprint: 'f1' },
    )
    await ready()
    expect(screen.getByTestId('cues-queued-stale')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'false')
    expect(screen.queryByTestId(`cue-wave-call-${bar(64)}`)).toBeNull()
    markAt(bar(32))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const req = saveRekordboxCues.mock.calls[0][0]
    expect(req.fingerprint).toBe('f2')
    expect(req.wanted).toContainEqual(extra)
  })

  it('says nothing about an old save when the queued one was built on the read it shows', async () => {
    setup(READ, { wanted: [{ ms: bar(64), kind: 0, color: null }], fingerprint: 'f0' })
    await ready()
    expect(screen.queryByTestId('cues-queued-stale')).toBeNull()
  })

  it('shows a loop read-only, with no drag, delete or colour', async () => {
    setup({ ...READ, cues: [{ id: 'l', ms: bar(32), kind: 1, color: 1, loop: true }] })
    await ready()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: bar(32) / 1000 })
    fireEvent.mouseMove(window, { clientX: bar(36) / 1000 })
    fireEvent.mouseUp(window, { clientX: bar(36) / 1000 })
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(32) / 400000) * 100}%`,
    )
    fireEvent.click(screen.getByTestId('cue-wave-hot-A'))
    expect(screen.getByTestId('cues-loop')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-delete')).toBeNull()
    expect(screen.queryByTestId('cues-colour')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Backspace' })
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
  })

  it('starts afresh on another track whose read looks the same, so a draft never saves onto the wrong track', async () => {
    const empty = { ...READ, fingerprint: '' }
    const { changeTrack, client, saveRekordboxCues } = setup(empty)
    client.setQueryData(['rekordbox-track-cues', '104'], { ...empty, contentId: '104' })
    client.setQueryData(['rekordbox-queued-cues', '104'], null)
    await ready()
    markAt(bar(64))
    expect(screen.getByTestId('cues-save')).toBeEnabled()
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(screen.getByTestId('cues-save')).toBeDisabled()
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('keeps the unsaved cues of a track while another track is open, so a forgotten Guardar loses nothing', async () => {
    const { changeTrack, client } = setup()
    client.setQueryData(['rekordbox-track-cues', '104'], { ...READ, contentId: '104' })
    client.setQueryData(['rekordbox-queued-cues', '104'], null)
    await ready()
    markAt(bar(64))
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
    markAt(bar(32))
    changeTrack({ contentId: '103', path: '/m/g.wav', label: 'Gowan' })
    await waitFor(() =>
      expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true'),
    )
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(16) / 400000) * 100}%`,
    )
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    await waitFor(() => expect(screen.getByTestId(`cue-wave-call-${bar(32)}`)).toBeInTheDocument())
  })

  it('never brings back a draft once rekordbox changed the cues of the track, even if the old read comes back', async () => {
    const { changeTrack, client } = setup()
    client.setQueryData(['rekordbox-track-cues', '104'], { ...READ, contentId: '104' })
    client.setQueryData(['rekordbox-queued-cues', '104'], null)
    await ready()
    markAt(bar(64))
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
    const extra = { id: 'x', ms: bar(100), kind: 1, color: 1 }
    client.setQueryData(['rekordbox-track-cues', '103'], {
      ...READ,
      fingerprint: 'f1',
      cues: [extra],
    })
    changeTrack({ contentId: '103', path: '/m/g.wav', label: 'Gowan' })
    await waitFor(() =>
      expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'false'),
    )
    expect(screen.queryByTestId(`cue-wave-call-${bar(64)}`)).toBeNull()
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    client.setQueryData(['rekordbox-track-cues', '103'], READ)
    changeTrack({ contentId: '103', path: '/m/g.wav', label: 'Gowan' })
    await waitFor(() => expect(screen.getByTestId('cues-save')).toBeDisabled())
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })

  it('never brings back a draft once the queued save of the track changed', async () => {
    const { changeTrack, client } = setup()
    client.setQueryData(['rekordbox-track-cues', '104'], { ...READ, contentId: '104' })
    client.setQueryData(['rekordbox-queued-cues', '104'], null)
    await ready()
    markAt(bar(64))
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
    client.setQueryData(['rekordbox-queued-cues', '103'], {
      wanted: [{ ms: bar(80), kind: 0, color: null }],
      fingerprint: 'f0',
    })
    changeTrack({ contentId: '103', path: '/m/g.wav', label: 'Gowan' })
    await waitFor(() => expect(screen.getByTestId(`cue-wave-call-${bar(80)}`)).toBeInTheDocument())
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })

  it('forgets the draft of a track once it is saved', async () => {
    const { changeTrack, client, saveRekordboxCues } = setup()
    client.setQueryData(['rekordbox-track-cues', '104'], { ...READ, contentId: '104' })
    client.setQueryData(['rekordbox-queued-cues', '104'], null)
    await ready()
    markAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    changeTrack({ contentId: '104', path: '/m/b.wav', label: 'Other' })
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
    changeTrack({ contentId: '103', path: '/m/g.wav', label: 'Gowan' })
    await ready()
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })

  it('says Sin guardar in the header while the track has changes, folded or full, and stops after Descartar', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-unsaved')).toBeNull()
    markAt(bar(64))
    await waitFor(() => expect(screen.getByTestId('cues-unsaved')).toHaveTextContent('Not saved'))
    await openFull()
    expect(screen.getByTestId('cues-header')).toContainElement(screen.getByTestId('cues-unsaved'))
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(screen.queryByTestId('cues-unsaved')).toBeNull())
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

  it('explains it could not read rekordbox when the read fails', async () => {
    setup(new Error('boom'))
    await waitFor(() => expect(screen.getByTestId('cues-unreadable')).toBeInTheDocument())
    expect(screen.queryByTestId('cues-save')).toBeNull()
  })

  it('explains it could not read rekordbox when there is no collection', async () => {
    setup(null)
    await waitFor(() => expect(screen.getByTestId('cues-unreadable')).toBeInTheDocument())
  })

  it('draws what rekordbox now holds as written once the queue landed and the cues were re-read', async () => {
    const { rekordboxTrackCues, rekordboxQueuedCues, client } = setup(READ, {
      wanted: writtenPlan(),
      fingerprint: 'f0',
    })
    await waitFor(() =>
      expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true'),
    )
    rekordboxTrackCues.mockResolvedValue({
      ...READ,
      fingerprint: 'f1',
      cues: writtenPlan().map((c, i) => ({ id: `w${i}`, ...c })),
    })
    rekordboxQueuedCues.mockResolvedValue(null)
    await client.invalidateQueries({ queryKey: ['rekordbox-track-cues'] })
    await client.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
    await waitFor(() =>
      expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'false'),
    )
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('shows what rekordbox says and logs when the queued save cannot be read', async () => {
    const { logError } = setup(READ, new Error('ipc down'))
    await ready()
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('ipc down'))
  })
})
