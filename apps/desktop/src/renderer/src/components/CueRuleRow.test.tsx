// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CueRule } from '../../../shared/cueFlows'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import '../i18n'
import { CueRuleRow } from './CueRuleRow'

afterEach(cleanup)

const RULE: CueRule = {
  from: 'drop',
  direction: 'back',
  bars: 16,
  repeat: 3,
  when: 'always',
  place: 'hot',
  color: { each: [1, 22, 42] },
}

function setup(rule: CueRule) {
  const onChange = vi.fn<(rule: CueRule) => void>()
  render(<CueRuleRow rule={rule} index={0} onChange={onChange} onRemove={vi.fn()} />)
  return { onChange }
}

const swatches = () => screen.getAllByTestId(/^cue-rule-0-color-\d$/)
const swatchOrder = () => swatches().map((el) => el.getAttribute('data-testid')?.slice(-1))
const distance = (slot: number) => screen.getByTestId(`cue-rule-0-color-${slot}-distance`)

describe('CueRuleRow colour swatches', () => {
  it('lists a backwards rule the way it reads on the wave, the farthest repetition on the left and the closest on the right', () => {
    setup(RULE)
    expect(swatchOrder()).toEqual(['2', '1', '0'])
    expect(screen.getByTestId('cue-rule-0-color-0')).toHaveStyle({
      backgroundColor: hotCueColor(1),
    })
    expect(screen.getByTestId('cue-rule-0-color-2')).toHaveStyle({
      backgroundColor: hotCueColor(42),
    })
    expect(distance(0)).toHaveTextContent('16')
    expect(distance(1)).toHaveTextContent('32')
    expect(distance(2)).toHaveTextContent('48')
    // Inside its square: under it, the numbers made the row taller than the sentence and
    // set the squares off the line of text.
    for (const slot of [0, 1, 2])
      expect(screen.getByTestId(`cue-rule-0-color-${slot}`)).toContainElement(distance(slot))
  })

  it('writes the stored repetition index of the swatch clicked, not its place on screen', () => {
    const { onChange } = setup(RULE)
    fireEvent.click(swatches()[0])
    const first = screen.getByTestId('cue-rule-0-color-2-palette').querySelector('button')
    if (!first) throw new Error('palette has no colours')
    fireEvent.click(first)
    expect(onChange).toHaveBeenCalledTimes(1)
    const each = (onChange.mock.calls[0][0].color as { each: number[] }).each
    expect(each[0]).toBe(1)
    expect(each[1]).toBe(22)
    expect(each[2]).not.toBe(42)
  })

  it('keeps a forwards rule closest first, which is already left to right in time', () => {
    setup({ ...RULE, direction: 'forward' })
    expect(swatchOrder()).toEqual(['0', '1', '2'])
    expect([0, 1, 2].map((i) => distance(i).textContent)).toEqual(['16', '32', '48'])
  })

  it('shows the distances of the first slots when the rule runs to the edge', () => {
    setup({ ...RULE, repeat: 'edge', bars: 8 })
    expect(swatchOrder()).toEqual(['2', '1', '0'])
    expect(distance(2)).toHaveTextContent('24')
    expect(distance(0)).toHaveTextContent('8')
  })

  it('shows no distance under the single swatch of a fixed colour', () => {
    setup({ ...RULE, color: { fixed: 22 } })
    expect(screen.queryByTestId('cue-rule-0-color-0-distance')).toBeNull()
  })
})
