// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UsbExportEvent, UsbPlanTrack } from '../../../shared/types'
import i18n from '../i18n'
import { createUsbExportStore, type UsbExportStore } from '../lib/usbExportStore'
import { TrackWave } from './TrackWave'
import { UsbExportPill } from './UsbExportPill'
import { UsbExportProgress } from './UsbExportProgress'
import { UsbTopProgress } from './UsbTopProgress'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

const t = (id: string, size: number, onStick = false, separator = false): UsbPlanTrack => ({
  id,
  title: `Title ${id}`,
  artist: 'K-Style',
  size,
  onStick,
  separator,
  cover: null,
  wave: [0.2, 0.9, 0.4],
})
const STARTED: UsbExportEvent = {
  type: 'started',
  tracks: [t('a', 70e6), t('b', 30e6, true), t('c', 50e6), t('sep', 1, false, true)],
  targetName: 'Surco',
  startedAt: 0,
}
const storeWith = (...events: UsbExportEvent[]): UsbExportStore => {
  const store = createUsbExportStore(() => 0)
  for (const e of events) store.dispatch(e)
  return store
}

function show(events: UsbExportEvent[]) {
  const handlers = { onBackground: vi.fn(), onCancel: vi.fn(), onClose: vi.fn() }
  const store = storeWith(...events)
  render(
    <UsbExportProgress
      store={store}
      footer={{ name: 'Surco', freeBytes: 21.4e9, filesystem: 'exfat' }}
      {...handlers}
    />,
  )
  return { ...handlers, store }
}

describe('UsbExportProgress', () => {
  it('lists every track with its state, and counts without the separator', () => {
    show([
      STARTED,
      { type: 'progress', index: 0, bytes: 35e6 },
      { type: 'track', index: 1, state: 'kept' },
    ])
    expect(screen.getByTestId('export-row-0')).toHaveAttribute('data-state', 'copying')
    expect(screen.getByTestId('export-row-1')).toHaveTextContent('ya estaba')
    expect(screen.getByTestId('export-row-2')).toHaveTextContent('en cola')
    expect(screen.getByTestId('usb-counter')).toHaveTextContent('1 / 3')
  })

  it('shows the size once a copied track is done', () => {
    show([STARTED, { type: 'track', index: 0, state: 'done' }])
    expect(screen.getByTestId('export-row-0')).toHaveTextContent('66,8 MB')
  })

  // baken's English never reaches the row: the reason is a code, translated.
  it('says why a track failed, in the user language', () => {
    show([STARTED, { type: 'failed', index: 2, reason: 'missing-file' }])
    expect(screen.getByTestId('export-row-2')).toHaveTextContent('no se encuentra el fichero')
  })

  it('names the stick, its free space and filesystem in the footer', () => {
    show([STARTED])
    expect(screen.getByTestId('usb-footer')).toHaveTextContent('Surco')
    expect(screen.getByTestId('usb-footer')).toHaveTextContent('exFAT')
  })

  // Closing never stops the export; the button says it goes on.
  it('keeps going in the background', () => {
    const h = show([STARTED])
    fireEvent.click(screen.getByTestId('usb-background'))
    expect(h.onBackground).toHaveBeenCalled()
  })

  it('offers cancel while copying, says it is cancelling, and none while writing the database', () => {
    const h = show([STARTED])
    fireEvent.click(screen.getByTestId('usb-cancel'))
    expect(h.onCancel).toHaveBeenCalled()
    act(() => h.store.dispatch({ type: 'cancelling' }))
    expect(screen.queryByTestId('usb-cancel')).toBeNull()
    expect(screen.getByTestId('usb-cancelling')).toBeInTheDocument()
    cleanup()
    show([STARTED, { type: 'database' }])
    expect(screen.queryByTestId('usb-cancel')).toBeNull()
    expect(screen.getByTestId('usb-finishing')).toBeInTheDocument()
  })

  // Main also stops the run on its own when the stick's device changes under it; the user
  // never pressed Cancelar, but the view must not keep offering it or look like it copies on.
  it('says it is stopping when main cancels without the user asking', () => {
    show([STARTED, { type: 'progress', index: 0, bytes: 1e6 }, { type: 'cancelling' }])
    expect(screen.queryByTestId('usb-cancel')).toBeNull()
    expect(screen.getByTestId('usb-cancelling')).toHaveTextContent('Cancelando…')
  })

  it('says it is done and the stick can be ejected', () => {
    show([
      STARTED,
      { type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 64000, syncFiles: true },
    ])
    expect(screen.getByTestId('usb-done')).toHaveTextContent(
      'Listo · 3 pistas en 1 min 4 s. Ya puedes expulsar el USB.',
    )
  })

  it('says why it stopped', () => {
    show([STARTED, { type: 'finished', outcome: 'error', reason: 'volume-gone' }])
    expect(screen.getByTestId('usb-error')).toHaveTextContent('El USB se desconectó')
  })
})

describe('UsbExportPill and UsbTopProgress', () => {
  // With the modal closed the export stays visible and one click away.
  it('shows the running export as a pill that reopens the modal', () => {
    const store = storeWith(STARTED, { type: 'track', index: 0, state: 'done' })
    const onOpen = vi.fn()
    render(<UsbExportPill store={store} hidden={false} onOpen={onOpen} />)
    expect(screen.getByTestId('usb-export-progress')).toHaveTextContent('USB 1/3')
    fireEvent.click(screen.getByTestId('usb-export-progress'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('has no pill while the modal is open or nothing runs', () => {
    render(<UsbExportPill store={storeWith(STARTED)} hidden onOpen={() => {}} />)
    render(<UsbExportPill store={storeWith()} hidden={false} onOpen={() => {}} />)
    expect(screen.queryByTestId('usb-export-progress')).toBeNull()
  })

  it('draws the top line only while it runs', () => {
    const { rerender } = render(<UsbTopProgress store={storeWith(STARTED)} />)
    expect(screen.getByTestId('top-progress')).toBeInTheDocument()
    rerender(<UsbTopProgress store={storeWith()} />)
    expect(screen.queryByTestId('top-progress')).toBeNull()
  })
})

describe('TrackWave', () => {
  const fill = () => screen.getByTestId('track-wave-fill')

  it('draws a faint dashed line for a queued track', () => {
    render(<TrackWave bars={[0.5]} state="queued" fraction={0} />)
    expect(screen.getByTestId('track-wave-queued')).toBeInTheDocument()
  })

  // The copying track reveals its waveform left to right as its bytes land.
  it('reveals the copied part of the waveform', () => {
    render(<TrackWave bars={[0.5]} state="copying" fraction={0.4} />)
    expect(fill().style.clipPath).toBe('inset(0 60% 0 0)')
    expect(fill().style.transition).toContain('clip-path')
  })

  it('is whole once done', () => {
    render(<TrackWave bars={[0.5]} state="done" fraction={0} />)
    expect(fill().style.clipPath).toBe('inset(0 0% 0 0)')
  })

  it('jumps to the percentage without animating under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    render(<TrackWave bars={[0.5]} state="copying" fraction={0.4} />)
    expect(fill().style.transition).toBe('none')
  })

  it('draws a flat bar for a track without analysis', () => {
    render(<TrackWave bars={null} state="done" fraction={1} />)
    expect(screen.getByTestId('track-wave')).toHaveAttribute('data-flat', 'true')
  })
})
