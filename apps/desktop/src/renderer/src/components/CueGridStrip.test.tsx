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
  const onClearPins = vi.fn<() => void>()
  render(
    <CueGridStrip
      source={null}
      beats={beatsFrom(0)}
      fit={FIT}
      durationMs={DURATION}
      tolerance={10}
      playheadMs={0}
      pins={[]}
      onSeek={onSeek}
      onClearPins={onClearPins}
      {...over}
    />,
  )
  return { onSeek, onClearPins }
}

const windows = () => screen.getAllByTestId(/^cues-grid-window-/)

describe('CueGridStrip', () => {
  // The DJ used to scroll to the end to see whether the grid opened up. Six beats spread over
  // the track answer that at a glance, with how far the grid sits from each kick.
  it('shows six beats spread over the whole track with how far the grid sits from each', () => {
    setup({ beats: beatsFrom(46) })
    expect(windows()).toHaveLength(6)
    expect(windows()[0]).toHaveAccessibleName('0:30, rejilla +46 ms')
    expect(windows()[5]).toHaveAccessibleName('5:30, rejilla +46 ms')
    expect(screen.getByTestId('cues-grid-track-summary')).toHaveTextContent('6 de 6 tramos fuera')
  })

  it('says the grid fits from start to end when every beat is within the tolerance', () => {
    setup({ beats: beatsFrom(4) })
    expect(screen.getByTestId('cues-grid-track-summary')).toHaveTextContent(
      'Cuadra de principio a fin',
    )
  })

  it('writes the offsets like the ones beside the time, with no sign on zero', () => {
    setup({ beats: beatsFrom(491) })
    expect(windows()[0]).toHaveAccessibleName('0:30, rejilla −9 ms')
    document.body.innerHTML = ''
    setup({ beats: beatsFrom(0) })
    expect(windows()[0]).toHaveAccessibleName('0:30, rejilla 0 ms')
  })

  it('puts the playhead on the kick of a beat when it is clicked, ready to pin it', () => {
    const { onSeek } = setup({ beats: beatsFrom(46) })
    fireEvent.click(windows()[5])
    expect(onSeek).toHaveBeenCalledWith(330000)
  })

  it('offers nothing to remove before the first pin', () => {
    setup()
    expect(screen.queryByTestId('cues-grid-unpin')).not.toBeInTheDocument()
  })

  it('removes the pins on demand, so the next pin starts from scratch', () => {
    const { onClearPins } = setup({ pins: [30000, 330000] })
    expect(screen.getByTestId('cues-grid-unpin')).toHaveTextContent('Quitar los 2 clavos')
    fireEvent.click(screen.getByTestId('cues-grid-unpin'))
    expect(onClearPins).toHaveBeenCalled()
  })
})
