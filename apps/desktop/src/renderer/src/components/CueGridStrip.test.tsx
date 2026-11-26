// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { auditHeard } from '../test/heardGrid'
import { CueGridStrip } from './CueGridStrip'

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

const FIT = { bpm: 120, firstMs: 0 }
const DURATION = 360000
const beatsFrom = (firstMs: number) => Array.from({ length: 720 }, (_, i) => firstMs + i * 500)

function setup({
  beats = beatsFrom(0),
  kicks = beats,
  fit = FIT,
  ...over
}: Partial<React.ComponentProps<typeof CueGridStrip>> & {
  beats?: number[]
  fit?: { bpm: number; firstMs: number }
} = {}) {
  const onSeek = vi.fn<(ms: number) => void>()
  render(
    <CueGridStrip
      audit={auditHeard(fit, beats)}
      kicks={kicks}
      durationMs={DURATION}
      tolerance={10}
      playheadMs={0}
      pins={[]}
      onSeek={onSeek}
      {...over}
    />,
  )
  return { onSeek }
}

const checks = () => screen.getAllByTestId(/^cues-grid-window-/)

describe('CueGridStrip', () => {
  // The DJ used to scroll to the end to see whether the grid opened up. Six beats spread over
  // the track answer that at a glance, each under its place on the whole-track wave.
  it('shows six beats spread over the whole track, each on the stretch measured nearest its place on the overview', () => {
    setup({ beats: beatsFrom(46) })
    expect(checks()).toHaveLength(6)
    expect(checks()[0]).toHaveAccessibleName('0:28, rejilla +46 ms')
    expect(checks()[0].style.left).toBe(`${(28000 / DURATION) * 100}%`)
    expect(checks()[5]).toHaveAccessibleName('5:28, rejilla +46 ms')
  })

  it('writes the offsets like the ones beside the time, with no sign on zero', () => {
    setup({ beats: beatsFrom(491) })
    expect(checks()[0]).toHaveAccessibleName('0:28, rejilla −9 ms')
    document.body.innerHTML = ''
    setup({ beats: beatsFrom(0) })
    expect(checks()[0]).toHaveAccessibleName('0:28, rejilla 0 ms')
  })

  // A draft an earlier Auto left on the offbeat must read as half a beat off, measured against
  // the kick of the grid the program analysed, not as on the beat.
  it('reads a draft left on the offbeat as half a beat off the kick of the program grid', () => {
    setup({ beats: beatsFrom(240), kicks: beatsFrom(0), fit: { bpm: 120, firstMs: 250 } })
    expect(checks()[0]).toHaveAccessibleName('0:28, rejilla +240 ms')
  })

  // With the kicks heard only in a few stretches, two of the six places land on the two ends
  // of the same stretch, seconds apart, and their offsets were printed one over the other.
  it('leaves out a beat that would sit on top of another one, so no two offsets overlap', () => {
    const heardAt = [
      ...Array.from({ length: 6 }, (_, i) => 230000 + i * 2000),
      ...Array.from({ length: 6 }, (_, i) => 340000 + i * 2000),
    ]
    setup({
      audit: {
        windows: heardAt.map((ms) => ({ ms, offsetMs: 0 })),
        total: 24,
        periodMs: 500,
        heardPerMinute: 30,
      },
    })
    const placed = checks().map((c) => Number.parseFloat(c.style.left))
    expect(placed.length).toBeGreaterThan(1)
    for (const [i, left] of placed.entries())
      for (const other of placed.slice(i + 1))
        expect(Math.abs(other - left)).toBeGreaterThanOrEqual(100 / 12)
  })

  it('puts the playhead on the kick of a beat when it is clicked, ready to pin it', () => {
    const { onSeek } = setup({ beats: beatsFrom(46) })
    fireEvent.click(checks()[5])
    expect(onSeek).toHaveBeenCalledWith(328000)
  })

  it('marks a pin on its beat, and a pin away from the six where it was put', () => {
    setup({ pins: [28000, 100000] })
    expect(checks()[0]).toHaveAttribute('data-pinned', 'true')
    expect(checks()[1]).not.toHaveAttribute('data-pinned')
    expect(screen.getByTestId('cues-grid-pin-100000').style.left).toBe(
      `${(100000 / DURATION) * 100}%`,
    )
  })
})
