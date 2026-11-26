// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Confetti } from './Confetti'

afterEach(cleanup)

function stubReducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

describe('Confetti', () => {
  // The burst is pure celebration, so a user who asked the OS to cut animation must get
  // nothing at all — no canvas to paint, no rAF loop running behind the modal.
  it('renders nothing when the user prefers reduced motion', () => {
    stubReducedMotion(true)
    render(<Confetti />)
    expect(screen.queryByTestId('confetti')).not.toBeInTheDocument()
  })

  it('renders the overlay canvas when motion is allowed', () => {
    stubReducedMotion(false)
    render(<Confetti />)
    const canvas = screen.getByTestId('confetti')
    expect(canvas).toBeInTheDocument()
  })
})

// jsdom paints nothing, so the canvas gets a context that records each piece it is asked to
// draw (where, and how opaque), and frames run only when the test steps them.
describe('Confetti burst', () => {
  interface Piece {
    x: number
    y: number
    alpha: number
  }
  let frames: Piece[][] = []
  let pending = new Map<number, FrameRequestCallback>()
  let nextId = 0

  function recordingContext(): CanvasRenderingContext2D {
    let at = { x: 0, y: 0 }
    const ctx: Partial<CanvasRenderingContext2D> = {
      globalAlpha: 1,
      fillStyle: '',
      clearRect: () => {
        frames.push([])
      },
      save: () => {},
      restore: () => {},
      rotate: () => {},
      translate: (x: number, y: number) => {
        at = { x, y }
      },
      fillRect: () => {
        frames[frames.length - 1].push({ ...at, alpha: ctx.globalAlpha ?? 1 })
      },
    }
    return ctx as CanvasRenderingContext2D
  }

  function step(): boolean {
    const [id, cb] = [...pending.entries()][0] ?? []
    if (id === undefined || !cb) return false
    pending.delete(id)
    cb(0)
    return true
  }

  // Capped so a loop that never settles fails the test instead of hanging the suite.
  function runOut(): number {
    let count = 0
    while (count < 1000 && step()) count += 1
    return count
  }

  beforeEach(() => {
    frames = []
    pending = new Map()
    stubReducedMotion(false)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(recordingContext)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      nextId += 1
      pending.set(nextId, cb)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // Two volleys from the bottom corners: every piece is on screen from the first frame, at
  // full strength, near the corner it was fired from.
  it('fires every piece from the two bottom corners at full opacity', () => {
    render(<Confetti />)
    step()
    const first = frames[0]
    expect(first).toHaveLength(140)
    expect(first.every((p) => p.alpha === 1)).toBe(true)
    expect(first.every((p) => p.y < window.innerHeight)).toBe(true)
    const fromLeft = first.filter((p) => p.x < window.innerWidth / 2)
    expect(fromLeft).toHaveLength(70)
    expect(fromLeft.every((p) => p.x > 0 && p.x < 60)).toBe(true)
  })

  // The streams have to climb and then come down; without gravity they would fly off the
  // top and the burst would read as a glitch rather than a celebration.
  it('climbs first and is pulled back down before it fades', () => {
    render(<Confetti />)
    runOut()
    const heightOf = (frame: Piece[]) => frame.reduce((sum, p) => sum + p.y, 0) / frame.length
    const apex = frames.reduce((best, f, i) => (heightOf(f) < heightOf(frames[best]) ? i : best), 0)
    expect(apex).toBeGreaterThan(5)
    expect(heightOf(frames[apex])).toBeLessThan(window.innerHeight / 2)
    expect(heightOf(frames[frames.length - 2])).toBeGreaterThan(heightOf(frames[apex]))
  })

  // Pieces hold full opacity through the climb and only fade at the end, so none blinks
  // out mid-air.
  it('fades the pieces only at the end of their fall', () => {
    render(<Confetti />)
    runOut()
    const lit = frames.filter((f) => f.length > 0)
    expect(lit.slice(0, 100).every((f) => f.every((p) => p.alpha === 1))).toBe(true)
    const tail = lit[lit.length - 1]
    expect(tail.every((p) => p.alpha > 0 && p.alpha < 1)).toBe(true)
  })

  // A loop that kept asking for frames after the last piece settled would burn the main
  // thread behind the donate modal for as long as it stays open.
  it('stops asking for frames once every piece has settled', () => {
    render(<Confetti />)
    const count = runOut()
    expect(count).toBeGreaterThan(100)
    expect(count).toBeLessThan(220)
    expect(frames[frames.length - 1]).toEqual([])
    expect(pending.size).toBe(0)
  })

  it('cancels the next frame when the modal closes mid-burst', () => {
    const { unmount } = render(<Confetti />)
    step()
    step()
    expect(pending.size).toBe(1)
    unmount()
    expect(pending.size).toBe(0)
  })
})
