// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { CueGridStrip } from './CueGridStrip'

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

const FIT = { bpm: 120, firstMs: 0 }
const DURATION = 360000
const beatsFrom = (firstMs: number) => Array.from({ length: 720 }, (_, i) => firstMs + i * 500)

function setup(over: Partial<React.ComponentProps<typeof CueGridStrip>> = {}) {
  const onSeek = vi.fn<(ms: number) => void>()
  render(
    <CueGridStrip
      beats={beatsFrom(0)}
      fit={FIT}
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
  it('shows six beats spread over the whole track, each under its place on the overview', () => {
    setup({ beats: beatsFrom(46) })
    expect(checks()).toHaveLength(6)
    expect(checks()[0]).toHaveAccessibleName('0:30, rejilla +46 ms')
    expect(checks()[0].style.left).toBe(`${(30000 / DURATION) * 100}%`)
    expect(checks()[5]).toHaveAccessibleName('5:30, rejilla +46 ms')
  })

  it('writes the offsets like the ones beside the time, with no sign on zero', () => {
    setup({ beats: beatsFrom(491) })
    expect(checks()[0]).toHaveAccessibleName('0:30, rejilla −9 ms')
    document.body.innerHTML = ''
    setup({ beats: beatsFrom(0) })
    expect(checks()[0]).toHaveAccessibleName('0:30, rejilla 0 ms')
  })

  it('puts the playhead on the kick of a beat when it is clicked, ready to pin it', () => {
    const { onSeek } = setup({ beats: beatsFrom(46) })
    fireEvent.click(checks()[5])
    expect(onSeek).toHaveBeenCalledWith(330000)
  })

  it('marks a pin on its beat, and a pin away from the six where it was put', () => {
    setup({ pins: [30000, 100000] })
    expect(checks()[0]).toHaveAttribute('data-pinned', 'true')
    expect(checks()[1]).not.toHaveAttribute('data-pinned')
    expect(screen.getByTestId('cues-grid-pin-100000').style.left).toBe(
      `${(100000 / DURATION) * 100}%`,
    )
  })
})
