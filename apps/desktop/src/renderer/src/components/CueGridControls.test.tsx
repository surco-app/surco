// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downbeatAt,
  type EditableGrid,
  fitGrid,
  gridAnchors,
  gridBeats,
  toggleAnchor,
} from '../../../shared/gridEdit'
import i18n from '../i18n'
import { CueGridControls } from './CueGridControls'

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

function setup(over: Partial<React.ComponentProps<typeof CueGridControls>> = {}) {
  const onChange = vi.fn<(grid: EditableGrid) => void>()
  const onDone = vi.fn<() => void>()
  render(
    <CueGridControls
      grid={{ bpm: 150, anchorMs: 46 }}
      disabledReason={null}
      fit={null}
      needsFix={false}
      playheadMs={4046}
      onChange={onChange}
      onDone={onDone}
      {...over}
    />,
  )
  return Object.assign(onChange, { onDone })
}

const lastGrid = (onChange: ReturnType<typeof setup>) => onChange.mock.calls.at(-1)?.[0]

describe('CueGridControls', () => {
  it('shows the BPM with two decimals in the app language, like rekordbox does', async () => {
    setup()
    expect(screen.getByTestId('cues-grid-bpm')).toHaveTextContent('150,00')
    await i18n.changeLanguage('en')
    setup()
    expect(screen.getAllByTestId('cues-grid-bpm')[1]).toHaveTextContent('150.00')
  })

  it('nudges the whole grid one millisecond, and ten with shift, for the shifted grid that is the common case', () => {
    const onChange = setup()
    fireEvent.click(screen.getByTestId('cues-grid-left'))
    expect(lastGrid(onChange)).toEqual({ bpm: 150, anchorMs: 45 })
    fireEvent.click(screen.getByTestId('cues-grid-right'))
    expect(lastGrid(onChange)).toEqual({ bpm: 150, anchorMs: 47 })
    fireEvent.click(screen.getByTestId('cues-grid-left'), { shiftKey: true })
    expect(lastGrid(onChange)).toEqual({ bpm: 150, anchorMs: 36 })
    fireEvent.click(screen.getByTestId('cues-grid-right'), { shiftKey: true })
    expect(lastGrid(onChange)).toEqual({ bpm: 150, anchorMs: 56 })
  })

  it('opens and closes the grid by a hundredth of a BPM keeping the beat under the playhead still', () => {
    const onChange = setup()
    const beatAtPlayhead = (grid: EditableGrid | undefined) =>
      gridBeats(grid as EditableGrid, 20000).some((b) => Math.abs(b.ms - 4046) < 0.5)
    fireEvent.click(screen.getByTestId('cues-grid-widen'))
    expect(lastGrid(onChange)?.bpm).toBeCloseTo(149.99, 6)
    expect(beatAtPlayhead(lastGrid(onChange))).toBe(true)
    fireEvent.click(screen.getByTestId('cues-grid-narrow'))
    expect(lastGrid(onChange)?.bpm).toBeCloseTo(150.01, 6)
    expect(beatAtPlayhead(lastGrid(onChange))).toBe(true)
  })

  it('puts the downbeat on the playhead', () => {
    const onChange = setup({ playheadMs: 1000 })
    fireEvent.click(screen.getByTestId('cues-grid-downbeat'))
    expect(lastGrid(onChange)).toEqual(downbeatAt({ bpm: 150, anchorMs: 46 }, 1000))
  })

  it('takes a typed BPM with a decimal comma', () => {
    const onChange = setup()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    const input = screen.getByTestId('cues-grid-bpm-input')
    fireEvent.change(input, { target: { value: '150,5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(lastGrid(onChange)?.bpm).toBe(150.5)
  })

  it.each(['abc', '', '0', '999'])(
    'ignores a typed BPM of "%s" instead of wrecking the grid',
    (typed) => {
      const onChange = setup()
      fireEvent.click(screen.getByTestId('cues-grid-bpm'))
      const input = screen.getByTestId('cues-grid-bpm-input')
      fireEvent.change(input, { target: { value: typed } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('closes the BPM menu with Escape without changing anything', () => {
    const onChange = setup()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    const input = screen.getByTestId('cues-grid-bpm-input')
    fireEvent.change(input, { target: { value: '151' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('cues-grid-bpm-menu')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('doubles and halves the BPM from its menu for a detector that landed on the wrong octave', () => {
    const onChange = setup()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    fireEvent.click(screen.getByTestId('cues-grid-double'))
    expect(lastGrid(onChange)).toEqual({ bpm: 300, anchorMs: 46 })
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    fireEvent.click(screen.getByTestId('cues-grid-half'))
    expect(lastGrid(onChange)).toEqual({ bpm: 75, anchorMs: 46 })
  })

  it('disables doubling past 300 BPM and halving below 40', () => {
    const fast = setup({ grid: { bpm: 175, anchorMs: 0 } })
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    expect(screen.getByTestId('cues-grid-double')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cues-grid-double'))
    expect(fast).not.toHaveBeenCalled()
  })

  it('disables halving below 40 BPM', () => {
    setup({ grid: { bpm: 70, anchorMs: 0 } })
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    expect(screen.getByTestId('cues-grid-half')).toBeDisabled()
  })

  it('keeps Auto off until the audio has been measured', () => {
    setup()
    expect(screen.getByTestId('cues-grid-auto')).toBeDisabled()
  })

  it('lights Auto when the grid misses the beats and fits it on click', () => {
    const fit = { bpm: 150, firstMs: 10 }
    const onChange = setup({ fit, needsFix: true })
    const auto = screen.getByTestId('cues-grid-auto')
    expect(auto).toHaveAttribute('data-needs-fix', 'true')
    fireEvent.click(auto)
    expect(lastGrid(onChange)).toEqual(fitGrid({ bpm: 150, anchorMs: 46 }, fit))
  })

  it('stays visible but greyed out with the reason when the grid cannot be edited, never vanishing', () => {
    const onChange = setup({
      disabledReason: 'Rejilla con varios tempos',
      fit: { bpm: 150, firstMs: 0 },
    })
    const group = screen.getByTestId('cues-grid')
    expect(group).toHaveAttribute('aria-disabled', 'true')
    expect(group).toHaveAttribute('title', 'Rejilla con varios tempos')
    for (const id of ['bpm', 'left', 'right', 'widen', 'narrow', 'downbeat', 'auto']) {
      const button = screen.getByTestId(`cues-grid-${id}`)
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats a missing grid like a disabled one', () => {
    setup({ grid: null })
    expect(screen.getByTestId('cues-grid')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('cues-grid-left')).toBeDisabled()
  })

  it('closes the BPM menu on a click outside it, like the other menus of the deck', () => {
    setup()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cues-grid-bpm-menu')).not.toBeInTheDocument()
  })

  it('closes the BPM menu when its button is pressed again', () => {
    setup()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    expect(screen.queryByTestId('cues-grid-bpm-menu')).not.toBeInTheDocument()
  })

  it('closes the BPM menu with Escape from any of its items, not only the field', () => {
    setup()
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    fireEvent.keyDown(screen.getByTestId('cues-grid-double'), { key: 'Escape' })
    expect(screen.queryByTestId('cues-grid-bpm-menu')).not.toBeInTheDocument()
  })

  it.each([
    [
      'Enter',
      () => {
        const input = screen.getByTestId('cues-grid-bpm-input')
        fireEvent.change(input, { target: { value: '151' } })
        fireEvent.keyDown(input, { key: 'Enter' })
      },
    ],
    [
      'Escape',
      () => fireEvent.keyDown(screen.getByTestId('cues-grid-bpm-input'), { key: 'Escape' }),
    ],
    ['×2', () => fireEvent.click(screen.getByTestId('cues-grid-double'))],
    ['a click outside', () => fireEvent.mouseDown(document.body)],
  ])(
    'hands the keys back to the editor when the BPM menu closes with %s, so Space and the arrows work at once',
    (_how, close) => {
      const { onDone } = setup()
      fireEvent.click(screen.getByTestId('cues-grid-bpm'))
      close()
      expect(onDone).toHaveBeenCalled()
    },
  )

  it('fits the grid on the beats around the playhead, not on the whole track', () => {
    const fit = {
      bpm: 150,
      firstMs: 0,
      phases: [
        { ms: 4000, firstMs: 25 },
        { ms: 200000, firstMs: 0 },
      ],
    }
    const onChange = setup({ fit, needsFix: true, playheadMs: 4046 })
    fireEvent.click(screen.getByTestId('cues-grid-auto'))
    expect(lastGrid(onChange)).toEqual({ bpm: 150, anchorMs: 25 })
  })

  it('opens a zone at the playhead with the anchor button, and closes it when pressed again there', () => {
    const onChange = setup({ playheadMs: 40010 })
    fireEvent.click(screen.getByTestId('cues-grid-anchor'))
    expect(gridAnchors(lastGrid(onChange) as EditableGrid)).toEqual([40046])
  })

  it('names the anchor button for what it will do at the playhead', () => {
    setup({ grid: toggleAnchor({ bpm: 150, anchorMs: 46 }, 40046), playheadMs: 40046 })
    expect(screen.getByTestId('cues-grid-anchor')).toHaveAccessibleName(
      'Quitar el ancla del cabezal',
    )
  })

  it('moves only the zone under the playhead', () => {
    const two = toggleAnchor({ bpm: 150, anchorMs: 46 }, 40046)
    const onChange = setup({ grid: two, playheadMs: 60046 })
    fireEvent.click(screen.getByTestId('cues-grid-right'))
    const beats = gridBeats(lastGrid(onChange) as EditableGrid, 80000)
    expect(beats.some((b) => b.ms === 20046)).toBe(true)
    expect(beats.some((b) => b.ms === 60047)).toBe(true)
  })

  it('doubles only the zone under the playhead and keeps the other zones', () => {
    const two = toggleAnchor({ bpm: 150, anchorMs: 46 }, 40046)
    const onChange = setup({ grid: two, playheadMs: 60046 })
    fireEvent.click(screen.getByTestId('cues-grid-bpm'))
    fireEvent.click(screen.getByTestId('cues-grid-double'))
    const next = lastGrid(onChange) as EditableGrid
    expect(next.bpm).toBe(150)
    expect(next.zones?.[0].bpm).toBe(300)
  })
})
