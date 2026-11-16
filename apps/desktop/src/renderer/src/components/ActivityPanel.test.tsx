// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { PanelGeometry } from '../lib/panelGeometry'
import { ActivityPanel } from './ActivityPanel'
import { ModalShell } from './ModalShell'

// jsdom implements neither PointerEvent nor pointer capture. Aliasing PointerEvent to
// MouseEvent lets fireEvent carry clientX/clientY (MouseEvent fields) into the handlers —
// same trick as the Waveform tests.
beforeAll(() => {
  ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
})

afterEach(cleanup)

function renderPanel(geometry: PanelGeometry, onGeometryChange = vi.fn()) {
  render(
    <ActivityPanel
      rows={[]}
      onClear={vi.fn()}
      onClose={vi.fn()}
      onCopy={vi.fn()}
      geometry={geometry}
      onGeometryChange={onGeometryChange}
    />,
  )
  return onGeometryChange
}

describe('ActivityPanel geometry persistence', () => {
  // The card used to reset to its default corner every open; reopening must restore
  // where the user parked and sized it last time.
  it('opens at the given position and size', () => {
    renderPanel({ pos: { x: 111, y: 222 }, size: { width: 333, height: 444 } })
    const panel = screen.getByTestId('activity-panel')
    expect(panel).toHaveStyle({ left: '111px', top: '222px', width: '333px', height: '444px' })
  })

  // The geometry is reported when a drag ends — reporting per pointer-move tick would
  // write the settings file for every pixel, and a mid-drag value is never what the
  // user chose.
  it('reports the new geometry only when the drag ends', () => {
    const onGeometryChange = renderPanel({
      pos: { x: 24, y: 80 },
      size: { width: 320, height: 360 },
    })
    const handle = screen.getByTestId('activity-panel-handle')
    handle.setPointerCapture = vi.fn()
    handle.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { clientX: 30, clientY: 90, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 190, pointerId: 1 })
    expect(onGeometryChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onGeometryChange).toHaveBeenCalledExactlyOnceWith({
      pos: { x: 124, y: 180 },
      size: { width: 320, height: 360 },
    })
  })
})

function startDrag(onGeometryChange = vi.fn()) {
  renderPanel({ pos: { x: 24, y: 80 }, size: { width: 320, height: 360 } }, onGeometryChange)
  const handle = screen.getByTestId('activity-panel-handle')
  handle.setPointerCapture = vi.fn()
  handle.releasePointerCapture = vi.fn()
  fireEvent.pointerDown(handle, { clientX: 30, clientY: 90, pointerId: 1 })
  return { handle, panel: screen.getByTestId('activity-panel') }
}

describe('ActivityPanel drag without a render per move', () => {
  it('follows the pointer through its transform without re-rendering left and top mid-drag', () => {
    const { handle, panel } = startDrag()
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 190, pointerId: 1 })
    expect(panel).toHaveStyle({ left: '24px', top: '80px' })
    expect(panel.style.transform).toBe('translate(100px, 100px)')
  })

  it('resists at a fifth of the overshoot past the left edge instead of stopping dead', () => {
    const { handle, panel } = startDrag()
    fireEvent.pointerMove(handle, { clientX: -94, clientY: 90, pointerId: 1 })
    expect(panel.style.transform).toBe('translate(-44px, 0px)')
  })

  it('persists the clamped position, not the elastic overshoot, when released past the edge', () => {
    const onGeometryChange = vi.fn()
    const { handle } = startDrag(onGeometryChange)
    fireEvent.pointerMove(handle, { clientX: -94, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onGeometryChange).toHaveBeenCalledExactlyOnceWith({
      pos: { x: 0, y: 80 },
      size: { width: 320, height: 360 },
    })
  })

  it('commits left and top and leaves no residual transform on release', () => {
    const { handle, panel } = startDrag()
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 190, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(panel).toHaveStyle({ left: '124px', top: '180px' })
    expect(panel.style.transform).toBe('')
  })
})

describe('ActivityPanel spring back after an edge release', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const flushFrames = () => {
    for (const [id, run] of frames) {
      frames.delete(id)
      run(0)
    }
  }
  afterEach(() => {
    frames.clear()
    vi.unstubAllGlobals()
  })
  const stubFrames = () => {
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      nextFrame += 1
      frames.set(nextFrame, run)
      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  }

  it('keeps a drag grabbed within a frame of the release free of the spring transition, so it still tracks the pointer one to one', () => {
    stubFrames()
    const { handle, panel } = startDrag()
    fireEvent.pointerMove(handle, { clientX: -94, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    fireEvent.pointerDown(handle, { clientX: 30, clientY: 90, pointerId: 1 })
    flushFrames()
    expect(panel.style.transition).toBe('')
  })

  it('drops the pending spring when the panel closes right after the release', () => {
    stubFrames()
    const { handle } = startDrag()
    fireEvent.pointerMove(handle, { clientX: -94, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(frames.size).toBe(1)
    cleanup()
    expect(frames.size).toBe(0)
  })
})

describe('ActivityPanel copy', () => {
  // The feed's whole trail — verdicts, per-step timings, the technical details folded
  // behind each row — pastes as plain text, so sharing it in a bug report or a chat
  // doesn't mean a screenshot that flattens exactly those details.
  it('hands the serialized feed to onCopy when the copy button is pressed', () => {
    const onCopy = vi.fn()
    render(
      <ActivityPanel
        rows={[
          {
            id: 'a',
            kind: 'discogs',
            status: 'done',
            label: 'Loading Discogs release #72490',
            ms: 2138,
          },
          { id: 'b', kind: 'match', status: 'done', label: 'No match: Airplay Edit', ms: 10980 },
        ]}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onCopy={onCopy}
        geometry={{ pos: { x: 0, y: 0 }, size: { width: 320, height: 360 } }}
        onGeometryChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('activity-copy'))
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(
      '[ok] Loading Discogs release #72490 — 2138 ms\n[ok] No match: Airplay Edit — 10980 ms',
    )
  })

  // An empty feed has nothing to share; a disabled button says so instead of copying
  // an empty string that would paste as nothing and read as a broken button.
  it('disables the copy button while the feed is empty', () => {
    renderPanel({ pos: { x: 0, y: 0 }, size: { width: 320, height: 360 } })
    expect(screen.getByTestId('activity-copy')).toBeDisabled()
  })
})

describe('ActivityPanel timer alignment', () => {
  // Timers form a right-aligned column the eye scans down. A row without a detail
  // (no chevron) or without a release link (no open-in-browser button) used to let
  // its timer slide right into the freed space, so the column jittered row by row.
  // Every row must reserve those slots whether or not it fills them.
  it('keeps the timer column identical across expandable, linked and plain rows', () => {
    render(
      <ActivityPanel
        rows={[
          {
            id: 'expandable',
            kind: 'discogs',
            status: 'done',
            label: 'Searching Discogs',
            detail: 'GET /database/search',
            ms: 4660,
          },
          {
            id: 'linked',
            kind: 'discogs',
            status: 'done',
            label: 'Loading Discogs release #301797',
            url: 'https://www.discogs.com/release/301797',
            ms: 4382,
          },
          { id: 'plain', kind: 'match', status: 'done', label: 'No match', ms: 20 },
        ]}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onCopy={vi.fn()}
        geometry={{ pos: { x: 0, y: 0 }, size: { width: 320, height: 360 } }}
        onGeometryChange={vi.fn()}
      />,
    )
    expect(screen.getAllByTestId('activity-chevron-slot')).toHaveLength(3)
    expect(screen.getAllByTestId('activity-url-slot')).toHaveLength(3)
  })
})

describe('ActivityPanel accessibility', () => {
  function renderRows(rows: React.ComponentProps<typeof ActivityPanel>['rows']): void {
    render(
      <ActivityPanel
        rows={rows}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onCopy={vi.fn()}
        geometry={{ pos: { x: 0, y: 0 }, size: { width: 320, height: 360 } }}
        onGeometryChange={vi.fn()}
      />,
    )
  }

  // The floating card is a landmark a screen reader user should be able to jump to and
  // recognise, not an anonymous div at the end of the page.
  it('is a named region', () => {
    renderRows([])
    expect(screen.getByRole('region', { name: i18n.t('activity.title') })).toBe(
      screen.getByTestId('activity-panel'),
    )
  })

  // The spinner, check and alert were aria-hidden glyphs with no words: whether a step
  // was still running, done or failed was visible only as an icon.
  it('speaks each step as running, done or failed', () => {
    renderRows([
      { id: 'a', kind: 'discogs', status: 'running', label: 'Searching Discogs' },
      { id: 'b', kind: 'discogs', status: 'done', label: 'Loading release' },
      { id: 'c', kind: 'cover', status: 'error', label: 'Downloading cover' },
    ])
    const rows = screen.getAllByTestId('activity-row')
    expect(rows[0]).toHaveAccessibleName(new RegExp(i18n.t('activity.statusRunning')))
    expect(rows[1]).toHaveAccessibleName(new RegExp(i18n.t('activity.statusDone')))
    expect(rows[2]).toHaveAccessibleName(new RegExp(i18n.t('activity.statusError')))
  })

  it('leaves a finished step uncoloured, so a failure is the colour the eye finds in a long feed', () => {
    renderRows([
      { id: 'b', kind: 'discogs', status: 'done', label: 'Loading release' },
      { id: 'c', kind: 'cover', status: 'error', label: 'Downloading cover' },
    ])
    const [done, failed] = screen.getAllByTestId('activity-status-icon')
    expect(done.getAttribute('class')).not.toMatch(/text-good/)
    expect(failed.getAttribute('class')).toMatch(/text-danger/)
  })

  it('speaks a step that ended with a warning', () => {
    renderRows([{ id: 'a', kind: 'applemusic', status: 'warn', label: 'Funk Freak' }])
    expect(screen.getByTestId('activity-row')).toHaveAccessibleName(
      new RegExp(i18n.t('activity.statusWarn')),
    )
  })

  // The rows fold their steps and details away; without aria-expanded nothing said a
  // row could open or whether it already had.
  it('marks the expandable rows as collapsed or expanded', () => {
    renderRows([
      {
        id: 'g',
        kind: 'discogs',
        status: 'done',
        label: 'Searching Discogs',
        children: [{ id: 'g1', kind: 'discogs', status: 'done', label: 'Page 1', detail: 'GET' }],
      },
      { id: 'p', kind: 'match', status: 'done', label: 'No match' },
    ])
    const [group, plain] = screen.getAllByTestId('activity-row')
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(plain).not.toHaveAttribute('aria-expanded')
    fireEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    const child = screen.getByTestId('activity-child')
    expect(child).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(child)
    expect(child).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a failure stamped by main as its translated sentence', () => {
    renderRows([
      {
        id: 'r',
        kind: 'applemusic',
        status: 'error',
        label: 'Funk Freak',
        detailKey: 'activity.reviewFixFileFailed',
        detailParams: { error: 'SURCO_ERR:noBackup: /m/Funk Freak.mp3' },
      },
    ])
    fireEvent.click(screen.getByTestId('activity-row'))
    const detail = screen.getByTestId('activity-row-detail')
    expect(detail).toHaveTextContent(i18n.t('errors.noBackup'))
    expect(detail).not.toHaveTextContent('SURCO_ERR')
  })

  it('opens a detail inside the animated body, so it grows into place instead of shoving the rows below', () => {
    renderRows([
      { id: 'p', kind: 'match', status: 'done', label: 'Plain', detail: 'GET /x' },
      {
        id: 'g',
        kind: 'discogs',
        status: 'done',
        label: 'Searching Discogs',
        children: [{ id: 'g1', kind: 'discogs', status: 'done', label: 'Page 1', detail: 'GET' }],
      },
    ])
    const [plain, group] = screen.getAllByTestId('activity-row')
    fireEvent.click(plain)
    expect(
      screen.getByTestId('activity-row-detail').closest('[data-testid="section-body"]'),
    ).not.toBeNull()
    fireEvent.click(group)
    const child = screen.getByTestId('activity-child')
    expect(child.closest('[data-testid="section-body"]')).not.toBeNull()
    fireEvent.click(child)
    const ownBody = screen
      .getByTestId('activity-child-detail')
      .closest('[data-testid="section-body"]')
    expect(ownBody).not.toBeNull()
    expect(child.parentElement?.contains(ownBody)).toBe(true)
  })

  // The open-in-browser button only faded in on mouse hover, so a keyboard user tabbing
  // onto it pressed an invisible control.
  it('shows the open-in-browser button when the keyboard reaches it', () => {
    renderRows([
      {
        id: 'l',
        kind: 'discogs',
        status: 'done',
        label: 'Loading release',
        url: 'https://www.discogs.com/release/1',
      },
    ])
    const open = screen.getByTestId('activity-open-url')
    expect(open.className).toContain('focus-visible:opacity-100')
    expect(open.className).toContain('group-focus-within:opacity-100')
  })
})

// Opening Settings with the panel up left it floating sharp over the blurred backdrop, on
// top of the dialog it couldn't even be clicked through (the modal makes it inert). It is a
// tool window like the macOS ones: a modal covers it, while menus and toasts still open
// over it.
describe('ActivityPanel stacking', () => {
  const layer = (el: Element): number => Number(/\bz-\[?(\d+)\]?/.exec(el.className)?.[1])

  it('sits under a modal and its backdrop', () => {
    render(
      <ModalShell onClose={vi.fn()} backdropTestId="shell-backdrop" className="w-80">
        <p>dialog</p>
      </ModalShell>,
    )
    const overlay = screen.getByTestId('shell-backdrop').parentElement as Element
    renderPanel({ pos: { x: 0, y: 0 }, size: { width: 300, height: 300 } })
    expect(layer(screen.getByTestId('activity-panel'))).toBeLessThan(layer(overlay))
  })
})
