// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { GridFit } from '../../../shared/gridEdit'
import type { TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
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
  cues: [{ id: 'c1', ms: 32000, kind: 1, color: 0 }],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
  gridFingerprint: 'g0',
}
const LATE: GridFit = { bpm: 120, firstMs: 46 }
const ON_BEAT: GridFit = { bpm: 120, firstMs: 0 }

afterEach(() => {
  cleanup()
  resetEditorSections()
  resetCueSession()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal(
    'Audio',
    class {
      onloadedmetadata: (() => void) | null = null
      onended: (() => void) | null = null
      currentTime = 0
      play = vi.fn<() => Promise<void>>(async () => {})
      pause = vi.fn<() => void>()
      load = vi.fn<() => void>()
      removeAttribute = vi.fn<(name: string) => void>()
    },
  )
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
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

function setup(fit: GridFit | null | Promise<GridFit | null>, read: TrackCues = READ) {
  const gridFit = vi.fn<Api['cues']['gridFit']>(async () => fit)
  installApi({
    cues: {
      trackCues: vi.fn<Api['cues']['trackCues']>(async () => read),
      queued: vi.fn<Api['cues']['queued']>(async () => null),
      waveDetail: vi.fn<Api['cues']['waveDetail']>(async () => null),
      gridFit,
    },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
        <CuesSection
          cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
          open
          onToggle={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { gridFit }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-detail')).toBeInTheDocument())
const fitButton = () => screen.getByTestId('cues-fit-grid')

describe('Ajustar rejilla in the folded section', () => {
  it('sits in the folded header before Auto marcar, since a grid fix comes before placing cues', async () => {
    setup(LATE)
    await ready()
    const header = screen.getByTestId('cues-flow-menu')
    expect(header).toContainElement(fitButton())
    expect(
      fitButton().compareDocumentPosition(screen.getByTestId('cues-auto-mark')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(fitButton()).toHaveTextContent('Fit grid')
  })

  it('lights up when the grid sits off the kicks and fixes it without opening full screen', async () => {
    setup(LATE)
    await ready()
    await waitFor(() => expect(fitButton()).toHaveAttribute('data-needs-fix', 'true'))
    fireEvent.click(fitButton())
    await waitFor(() => expect(screen.getByTestId('cues-unsaved')).toBeInTheDocument())
    expect(fitButton()).not.toHaveAttribute('data-needs-fix')
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'false')
  })

  it('stays calm on a grid already on the kicks, so the accent only asks for real work', async () => {
    setup(ON_BEAT)
    await ready()
    await waitFor(() => expect(fitButton()).toBeEnabled())
    expect(fitButton()).not.toHaveAttribute('data-needs-fix')
  })

  it('spins inside the button while Surco still reads the file, so a disabled Fit grid reads as waiting and not as broken', async () => {
    let finish: (fit: GridFit | null) => void = () => {}
    setup(new Promise<GridFit | null>((resolve) => (finish = resolve)))
    await ready()
    expect(fitButton()).toBeDisabled()
    expect(fitButton()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('cues-fit-grid-spinner')).toBeInTheDocument()
    finish(LATE)
    await waitFor(() => expect(fitButton()).toBeEnabled())
    expect(screen.queryByTestId('cues-fit-grid-spinner')).toBeNull()
    expect(fitButton()).not.toHaveAttribute('aria-busy')
  })

  it('stops spinning when the read finds no beats, so the wait never looks endless', async () => {
    const { gridFit } = setup(null)
    await ready()
    await waitFor(() => expect(gridFit).toHaveBeenCalledWith('103'))
    await waitFor(() => expect(screen.queryByTestId('cues-fit-grid-spinner')).toBeNull())
    expect(fitButton()).toBeDisabled()
  })

  it('stays visible but disabled when Surco finds no beats to fit, instead of vanishing', async () => {
    const { gridFit } = setup(null)
    await ready()
    await waitFor(() => expect(gridFit).toHaveBeenCalledWith('103'))
    expect(fitButton()).toBeDisabled()
  })

  it('leaves full screen with the one Auto in its grid controls, never two buttons for the same fix', async () => {
    setup(LATE)
    await ready()
    fireEvent.click(screen.getByTestId('section-maximize'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
    )
    expect(screen.queryByTestId('cues-fit-grid')).toBeNull()
  })
})
