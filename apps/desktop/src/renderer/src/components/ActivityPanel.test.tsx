// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { PanelGeometry } from '../lib/panelGeometry'
import { ActivityPanel } from './ActivityPanel'

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
