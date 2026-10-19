// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import '../i18n'
import { resetRowWaves } from '../lib/rowWaves'
import { RowWave } from './RowWave'

beforeEach(() => {
  ;(window as unknown as { api: Partial<Api> }).api = {
    rowWaves: vi.fn<Api['rowWaves']>(async () => ({ '/a.DAT': Array(100).fill(0.5) })),
  }
})
afterEach(() => {
  cleanup()
  resetRowWaves()
})

const request = { path: '/m/a.wav', analysisPath: '/a.DAT' }
const cues = [
  { ms: 0, kind: 1, color: 42 },
  { ms: 32000, kind: 0, color: null },
  { ms: 64000, kind: 2, color: 22 },
]

describe('RowWave', () => {
  it('draws the wave once it arrives', async () => {
    render(<RowWave request={request} cues={[]} durationSec={128} pending={false} active />)
    expect(await screen.findByTestId('track-wave-bars')).toBeInTheDocument()
  })

  it('asks nothing until its row is on screen, yet draws a wave it already knows', async () => {
    const { rerender } = render(
      <RowWave request={request} cues={[]} durationSec={128} pending={false} active={false} />,
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(window.api.rowWaves).not.toHaveBeenCalled()
    rerender(<RowWave request={request} cues={[]} durationSec={128} pending={false} active />)
    expect(await screen.findByTestId('track-wave-bars')).toBeInTheDocument()
    rerender(
      <RowWave request={request} cues={[]} durationSec={128} pending={false} active={false} />,
    )
    expect(screen.getByTestId('track-wave-bars')).toBeInTheDocument()
  })

  it('places hot cues as lettered squares and memory cues as triangles along the track', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending={false} active />)
    const hot = screen.getAllByTestId('track-hot-cue')
    expect(hot.map((h) => h.textContent)).toEqual(['A', 'B'])
    expect(hot[1].style.left).toBe('calc(50% - 6px)')
    expect(screen.getAllByTestId('track-memory-cue')).toHaveLength(1)
    expect(screen.getByTestId('track-wave')).toHaveAccessibleName('2 hot cues')
  })

  it('draws no cue it cannot place, for a track with no length or a cue past the end', () => {
    const { rerender } = render(
      <RowWave request={request} cues={cues} durationSec={0} pending={false} active />,
    )
    expect(screen.queryAllByTestId('track-hot-cue')).toHaveLength(0)
    rerender(
      <RowWave
        request={request}
        cues={[{ ms: 999000, kind: 1, color: null }]}
        durationSec={128}
        pending={false}
        active
      />,
    )
    expect(screen.queryAllByTestId('track-hot-cue')).toHaveLength(0)
  })

  it('draws cues still waiting for rekordbox hollow', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending active />)
    expect(screen.getByTestId('track-wave')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('track-wave')).toHaveAccessibleName(
      '2 hot cues waiting for rekordbox',
    )
  })

  it('paints each cue in the colour rekordbox gives it', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending={false} active />)
    const [a, b] = screen.getAllByTestId('track-hot-cue')
    expect(a).toHaveStyle({ backgroundColor: '#e62828' })
    expect(b).toHaveStyle({ backgroundColor: '#28e214' })
    expect(screen.getByTestId('track-memory-cue')).toHaveStyle({ borderTopColor: '#e62828' })
  })

  it('keeps a waiting cue hollow in its own colour', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending active />)
    const [a] = screen.getAllByTestId('track-hot-cue')
    expect(a).toHaveStyle({ borderColor: '#e62828', color: '#e62828' })
  })

  it('marks a track whose cues wait for rekordbox even before it has any hot cue', () => {
    render(<RowWave request={request} cues={[]} durationSec={128} pending active />)
    expect(screen.getByTestId('track-cue-pending')).toBeInTheDocument()
    expect(screen.getByTestId('track-wave')).toHaveAccessibleName('Cues waiting for rekordbox')
  })
})
