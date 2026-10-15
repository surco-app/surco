// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LimiterGlimpse as Glimpse } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { installApi } from '../test/api'
import { drawGlimpse, LimiterGlimpse } from './LimiterGlimpse'

afterEach(cleanup)
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
})

const glimpse: Glimpse = { worse: [-0.5, 0.5, -0.5, 0.5], better: [-0.6, 0.6, -0.5, 0.9] }

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>)
}

const props = {
  worsePath: '/music/memories.wav',
  betterPath: '/downloads/memories.aif',
  sampleRate: 44100,
  layers: [
    { side: 'better', label: 'This file · AIF' },
    { side: 'worse', label: 'Apple Music · WAV' },
  ],
} as const

describe('LimiterGlimpse', () => {
  // The worse copy sets the stretch and the rate: it is where the limiter pinned its
  // samples, and decoding it at another rate would reshape the very peaks shown.
  it('asks for the stretch of the worse copy at its own rate', async () => {
    const api = installApi({ limiterGlimpse: vi.fn(async () => glimpse) })
    renderWithQuery(<LimiterGlimpse {...props} />)
    expect(await screen.findByTestId('limiter-glimpse')).toBeInTheDocument()
    expect(api.limiterGlimpse).toHaveBeenCalledWith(
      '/music/memories.wav',
      '/downloads/memories.aif',
      44100,
    )
  })

  // Comparing means looking at one copy, then the other, then both: each legend entry hides
  // or shows its own copy and never the other.
  it('hides and shows each copy from its legend entry on its own', async () => {
    installApi({ limiterGlimpse: vi.fn(async () => glimpse) })
    renderWithQuery(<LimiterGlimpse {...props} />)
    const here = await screen.findByTestId('glimpse-toggle-better')
    const library = screen.getByTestId('glimpse-toggle-worse')
    expect(here).toHaveTextContent('This file · AIF')
    fireEvent.click(here)
    expect(here).toHaveAttribute('aria-pressed', 'false')
    expect(library).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(here)
    expect(here).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows nothing when the stretch could not be measured', async () => {
    const api = installApi({ limiterGlimpse: vi.fn(async () => null) })
    renderWithQuery(<LimiterGlimpse {...props} />)
    await vi.waitFor(() => expect(api.limiterGlimpse).toHaveBeenCalled())
    await vi.waitFor(() => expect(screen.queryByTestId('glimpse-placeholder')).toBeNull())
    expect(screen.queryByTestId('limiter-glimpse')).toBeNull()
  })
})

describe('drawGlimpse', () => {
  function recorder() {
    const fills: string[] = []
    const alphas: number[] = []
    const ctx = {
      fillStyle: '',
      globalAlpha: 1,
      clearRect: vi.fn(),
      fillRect: vi.fn(function (this: { fillStyle: string; globalAlpha: number }) {
        fills.push(this.fillStyle)
        alphas.push(this.globalAlpha)
      }),
      strokeStyle: '',
      lineWidth: 1,
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    }
    return { ctx, fills, alphas }
  }
  const colors = { better: 'rgb(1, 1, 1)', worse: 'rgb(2, 2, 2)' }

  // The better copy goes underneath so that only what rises past the worse one shows: drawn
  // on top it would cover the worse copy and hide the difference it is there to show.
  it('draws the better copy first and the worse one over it', () => {
    const { ctx, fills } = recorder()
    drawGlimpse(
      ctx as unknown as CanvasRenderingContext2D,
      glimpse,
      { better: true, worse: true },
      colors,
      100,
      50,
    )
    expect(fills.indexOf(colors.better)).toBeLessThan(fills.indexOf(colors.worse))
    expect(fills.lastIndexOf(colors.better)).toBeLessThan(fills.indexOf(colors.worse))
  })

  it('leaves a hidden copy out entirely', () => {
    const { ctx, fills } = recorder()
    drawGlimpse(
      ctx as unknown as CanvasRenderingContext2D,
      glimpse,
      { better: false, worse: true },
      colors,
      100,
      50,
    )
    expect(fills).not.toContain(colors.better)
    expect(fills).toContain(colors.worse)
  })

  // One scale for both copies whatever is shown, so hiding one never rescales the other
  // and a toggle compares heights truthfully.
  it('keeps the same scale when a copy is hidden', () => {
    const both = recorder()
    drawGlimpse(
      both.ctx as unknown as CanvasRenderingContext2D,
      glimpse,
      { better: true, worse: true },
      colors,
      100,
      50,
    )
    const alone = recorder()
    drawGlimpse(
      alone.ctx as unknown as CanvasRenderingContext2D,
      glimpse,
      { better: false, worse: true },
      colors,
      100,
      50,
    )
    const worseRects = (r: ReturnType<typeof recorder>) =>
      r.ctx.fillRect.mock.calls.filter((_, i) => r.fills[i] === colors.worse)
    expect(worseRects(alone)).toEqual(worseRects(both))
  })

  // At the same loudness the two copies differ only by a dB or two on the hits; the worse
  // copy's ceiling drawn across makes plain that one stops there and the other goes past.
  // It stays when the worse copy is hidden, so the better one is still read against it.
  it('marks the worse copy ceiling on both sides, also with that copy hidden', () => {
    const { ctx } = recorder()
    drawGlimpse(
      ctx as unknown as CanvasRenderingContext2D,
      glimpse,
      { better: true, worse: false },
      colors,
      100,
      50,
    )
    const ys = ctx.moveTo.mock.calls.map(([, y]) => y)
    const scale = 23 / 0.9
    expect(ys).toHaveLength(2)
    expect(ys[0]).toBeCloseTo(25 - 0.5 * scale)
    expect(ys[1]).toBeCloseTo(25 + 0.5 * scale)
  })

  // Drawn solid, the worse copy covered the better one everywhere but the hits, and the
  // better copy looked missing. See-through, both shapes read at once; alone it is solid.
  it('lets the better copy show through the worse one only while both are shown', () => {
    const alphaOf = (show: { better: boolean; worse: boolean }, side: 'better' | 'worse') => {
      const r = recorder()
      drawGlimpse(r.ctx as unknown as CanvasRenderingContext2D, glimpse, show, colors, 100, 50)
      return new Set(r.alphas.filter((_, i) => r.fills[i] === colors[side]))
    }
    const both = { better: true, worse: true }
    expect([...alphaOf(both, 'worse')].every((a) => a < 1)).toBe(true)
    expect(alphaOf(both, 'better')).toEqual(new Set([1]))
    expect(alphaOf({ better: false, worse: true }, 'worse')).toEqual(new Set([1]))
  })
})
