// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PanelGeometry } from '../lib/panelGeometry'
import '../i18n'
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
