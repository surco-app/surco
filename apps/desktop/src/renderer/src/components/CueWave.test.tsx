// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { CueWave } from './CueWave'

afterEach(cleanup)

const GRID = Array.from({ length: 160 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 80,
    right: 800,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(over: Partial<React.ComponentProps<typeof CueWave>> = {}) {
  const onAddDrop = vi.fn()
  const onRemoveDrop = vi.fn()
  render(
    <CueWave
      wave={[{ h: 1, rgb: [255, 0, 0] }]}
      grid={GRID}
      durationMs={80000}
      hot={[{ ms: 16000, kind: 1, color: 42, pending: false }]}
      drops={[{ ms: 40000, pending: true }]}
      onAddDrop={onAddDrop}
      onRemoveDrop={onRemoveDrop}
      {...over}
    />,
  )
  return { onAddDrop, onRemoveDrop }
}

describe('CueWave', () => {
  it('draws hot cues with their letter and drops with DROP', () => {
    setup()
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveTextContent('A')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('DROP')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveAttribute('data-pending', 'true')
    expect(
      screen.getAllByTestId('cue-wave-bar').filter((b) => b.dataset.strong === 'true'),
    ).toHaveLength(3)
  })

  it('adds a drop on the beat under the click', () => {
    const { onAddDrop } = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(onAddDrop).toHaveBeenCalledWith(10000)
  })

  it('removes the drop under the click', () => {
    const { onRemoveDrop, onAddDrop } = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 400, clientY: 40 })
    expect(onRemoveDrop).toHaveBeenCalledWith(40000)
    expect(onAddDrop).not.toHaveBeenCalled()
  })

  it('shows where the drop will land while hovering', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('+ drop')
  })

  it('names the beat the hover will take, so the user can tell which of the beats under the pointer it is', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('0:10.000')
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('6.1')
  })

  it('names where each drop sits', () => {
    setup()
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('0:40.000')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('21.1')
  })

  it('turns the label of a drop near the end to the left so the edge does not cut it', () => {
    setup({ drops: [{ ms: 76000, pending: true }] })
    expect(screen.getByTestId('cue-wave-drop-label-76000')).toHaveAttribute('data-side', 'left')
  })

  it('stacks the labels of two close drops instead of drawing them over each other', () => {
    setup({
      drops: [
        { ms: 40000, pending: false },
        { ms: 42000, pending: true },
      ],
    })
    expect(screen.getByTestId('cue-wave-drop-label-40000')).toHaveAttribute('data-row', '0')
    expect(screen.getByTestId('cue-wave-drop-label-42000')).toHaveAttribute('data-row', '1')
  })

  it('takes no clicks when disabled', () => {
    const { onAddDrop } = setup({ disabled: true })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(onAddDrop).not.toHaveBeenCalled()
  })

  it('says the track is not analysed and takes no clicks when it has no grid', () => {
    const { onAddDrop } = setup({ grid: [] })
    expect(screen.getByTestId('cue-wave-not-analysed')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-wave-not-analysed'), { clientX: 100, clientY: 40 })
    expect(onAddDrop).not.toHaveBeenCalled()
  })

  it.each([800, 1600])(
    'removes a drop 5 px away and adds beside it 8 px away at %i px wide',
    (width) => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width,
        height: 80,
        right: width,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      const centre = width / 2
      const { onAddDrop, onRemoveDrop } = setup()
      fireEvent.click(screen.getByTestId('cue-wave'), { clientX: centre + 5, clientY: 40 })
      expect(onRemoveDrop).toHaveBeenCalledWith(40000)
      expect(onAddDrop).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('cue-wave'), { clientX: centre + 8, clientY: 40 })
      expect(onAddDrop).toHaveBeenCalledTimes(1)
      expect(onAddDrop.mock.calls[0][0]).not.toBe(40000)
    },
  )

  it('shows no ghost over an existing drop', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 400, clientY: 40 })
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
  })

  it('clears the ghost after a click', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
  })

  it('clears the ghost when it becomes disabled and does not bring it back on enabling', () => {
    const props = {
      wave: null,
      grid: GRID,
      durationMs: 80000,
      hot: [],
      drops: [],
      onAddDrop: vi.fn(),
      onRemoveDrop: vi.fn(),
    }
    const { rerender } = render(<CueWave {...props} />)
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toBeInTheDocument()
    rerender(<CueWave {...props} disabled />)
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
    rerender(<CueWave {...props} />)
    expect(screen.queryByTestId('cue-wave-ghost')).not.toBeInTheDocument()
  })
})
