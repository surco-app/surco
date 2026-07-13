// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BeatgridResult, WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { GridSection } from './GridSection'

afterEach(cleanup)

const detected: BeatgridResult = { bpm: 120, confidence: 0.9, anchorSec: 0.25 }

function wave(): WaveformResult {
  return { peaks: Array.from({ length: 200 }, () => 0.3), durationSec: 60 }
}

const play = vi.fn()
const pause = vi.fn()
const audios: { onloadedmetadata: (() => void) | null; currentTime: number }[] = []

let client: QueryClient
beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  // jsdom has no audio pipeline; the audition only needs seek/play/pause and the
  // loadedmetadata hook the component waits on before seeking.
  vi.stubGlobal(
    'Audio',
    class {
      onloadedmetadata: (() => void) | null = null
      ontimeupdate: (() => void) | null = null
      onended: (() => void) | null = null
      currentTime = 0
      play = play
      pause = pause
      constructor() {
        audios.push(this)
      }
    },
  )
  // jsdom has no 2D canvas context; the draw helper already handles null.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
  client = createQueryClient()
  ;(window as unknown as { api: unknown }).api = {
    beatgrid: vi.fn().mockResolvedValue(detected),
    waveform: vi.fn().mockResolvedValue(wave()),
  }
})

afterEach(() => vi.unstubAllGlobals())

function section(over: Partial<React.ComponentProps<typeof GridSection>> = {}): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <GridSection
        value={undefined}
        open
        onToggle={() => {}}
        onChange={() => {}}
        inputPath="/in/track.wav"
        {...over}
      />
    </QueryClientProvider>
  )
}

describe('GridSection header', () => {
  // The detection's finding rides the header as a pill, the app's one convention
  // for analysis results — readable without opening the section.
  it('pills the detected tempo once the analysis lands', async () => {
    render(section())
    const pill = await screen.findByTestId('grid-detected-pill', undefined, { timeout: 3000 })
    expect(pill).toHaveTextContent('Detected 120.0 BPM')
  })

  // A user-confirmed grid outranks the suggestion: the folded header wears it as
  // the accent badge, same semantics as the trim's active cut badge.
  it('wears a staged grid as the folded active badge', () => {
    render(section({ value: { bpm: 127.5, anchorSec: 0.1 }, open: false }))
    expect(screen.getByTestId('grid-active-badge')).toHaveTextContent('127.50 BPM')
    expect(screen.queryByTestId('grid-detected-pill')).not.toBeInTheDocument()
  })

  // Beatless material measures null: the section must say so instead of leaving
  // an empty body that reads as a broken analysis.
  it('says when no steady beat was found', async () => {
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = vi
      .fn()
      .mockResolvedValue(null)
    render(section())
    const nothing = await screen.findByTestId('grid-nothing', undefined, { timeout: 3000 })
    expect(nothing).toHaveTextContent('No steady beat detected.')
  })

  // The detection decodes minutes of audio; a folded section must not pay for it.
  it('does not analyse while folded', async () => {
    const probe = vi.fn().mockResolvedValue(detected)
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = probe
    render(section({ open: false }))
    await new Promise((r) => setTimeout(r, 1200))
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('GridSection grid', () => {
  // The detected grid shows live before anything is staged: lines every beat at
  // the detected phase, downbeats emphasised — what the user judges and adjusts.
  it('draws the detected grid with downbeats phased to the anchor', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const downbeats = screen.getAllByTestId('grid-line-downbeat')
    const beats = screen.getAllByTestId('grid-line')
    // 60 s at 120 BPM from 0.25 s: 120 beats, every fourth a downbeat.
    expect(downbeats.length + beats.length).toBe(120)
    expect(downbeats[0].style.left).toBe(`${(0.25 / 60) * 100}%`)
    expect(beats.length).toBe(downbeats.length * 3)
  })

  it('nudges the grid earlier and later by 10 ms', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-nudge-earlier'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.24 })
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.26 })
  })

  // Shifting by a whole beat re-phases the downbeat count without moving any
  // line — how a grid whose bar-1 landed on the wrong beat gets fixed.
  it('shifts the anchor by one beat from the beat buttons', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-beat-forward'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.75 })
  })

  // Half/double-time is tempo detection's inherent ambiguity; fixing it must be
  // one click, not retyping.
  it('halves and doubles the BPM around the same anchor', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-bpm-half'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 60, anchorSec: 0.25 })
    fireEvent.click(screen.getByTestId('grid-bpm-double'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 240, anchorSec: 0.25 })
  })

  it('commits a typed BPM on Enter and ignores garbage', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const input = screen.getByTestId('grid-bpm-input')
    fireEvent.change(input, { target: { value: '130' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ bpm: 130, anchorSec: 0.25 })
    onChange.mockClear()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  // A BPM the grid can't use (out of any deck's range) must not stage: the
  // normalize guard is the same one that repairs session.json.
  it('rejects an out-of-range typed BPM', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const input = screen.getByTestId('grid-bpm-input')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  // "Auto": one click back to the detected grid, exactly like the trim's reset —
  // undefined means "use detected", so the suggestion shows again.
  it('resets to the detected grid from the Auto button', async () => {
    const onChange = vi.fn()
    render(section({ value: { bpm: 128, anchorSec: 0.5 }, onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-reset'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('offers no Auto button before anything is staged', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    expect(screen.queryByTestId('grid-reset')).not.toBeInTheDocument()
  })

  // The audition must start ON a beat: hearing the click land on the transient
  // is the whole check, so it seeks to the first grid beat in view.
  it('auditions from the first beat of the visible window', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-audition'))
    expect(audios).toHaveLength(1)
    audios[0].onloadedmetadata?.()
    expect(audios[0].currentTime).toBeCloseTo(0.25, 6)
    expect(play).toHaveBeenCalled()
  })
})
