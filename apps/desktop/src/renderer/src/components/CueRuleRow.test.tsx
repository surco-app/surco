// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CueRule } from '../../../shared/cueFlows'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import i18n from '../i18n'
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

const options = (block: string) =>
  screen
    .getAllByRole('menuitemradio')
    .map((el) => el.getAttribute('data-testid')?.replace(`cue-rule-0-${block}-option-`, ''))

describe('CueRuleRow condition menu', () => {
  it('offers until the previous mark on a countdown from the mark, each option with a line saying what it does', () => {
    setup({ ...RULE, when: 'fits' })
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(options('when')).toEqual(['fits', 'previous', 'always', 'room', 'clear'])
    expect(screen.getByTestId('cue-rule-0-when-option-previous-hint')).not.toBeEmptyDOMElement()
  })

  it('leaves out the conditions that change nothing on a cue placed on the same beat', () => {
    setup({ ...RULE, from: 'first-beat', bars: 0, repeat: 1, when: 'always' })
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(options('when')).toEqual(['always', 'room', 'clear', 'first'])
  })

  it('still lists the condition a rule already has, so a saved flow never shows a choice it cannot keep', () => {
    setup({ ...RULE, from: 'first-beat', bars: 0, repeat: 1, when: 'fits' })
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(options('when')).toContain('fits')
  })

  it('looks 8 bars ahead when room is picked, and the bars are a token of their own', () => {
    const { onChange } = setup({ ...RULE, from: 'first-beat', bars: 0, repeat: 1 })
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    fireEvent.click(screen.getByTestId('cue-rule-0-when-option-room'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ when: 'room', gap: 8 }))
  })

  it('writes the bars a room rule looks ahead from its own token', () => {
    const { onChange } = setup({ ...RULE, bars: 0, repeat: 1, when: 'room', gap: 8 })
    expect(screen.getByTestId('cue-rule-0-gap')).toHaveTextContent('8')
    fireEvent.click(screen.getByTestId('cue-rule-0-gap'))
    fireEvent.click(screen.getByTestId('cue-rule-0-gap-option-16'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ when: 'room', gap: 16 }))
  })

  it('drops the bars ahead when the rule leaves room, so no stray field reaches the saved flow', () => {
    const { onChange } = setup({ ...RULE, bars: 0, repeat: 1, when: 'room', gap: 12 })
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    fireEvent.click(screen.getByTestId('cue-rule-0-when-option-always'))
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('gap')
  })
})

describe('CueRuleRow room sentence', () => {
  const room: CueRule = { ...RULE, from: 'first-beat', bars: 0, repeat: 1, when: 'room', gap: 8 }
  const sentence = () => screen.getByTestId('cue-rule-0').textContent?.replace(/\s+/g, ' ') ?? ''

  it('reads with the bars where each language puts them, after the condition in English', () => {
    setup(room)
    expect(sentence()).toContain('if no other cue comes in the next 8 bars, place')
  })

  it('closes the German sentence after the bars, which German needs before its verb', async () => {
    await i18n.changeLanguage('de')
    try {
      setup(room)
      expect(sentence()).toContain('wenn in den nächsten 8 Takten kein anderer Cue kommt,')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('names the condition in the list without the bars, so it reads whole on its own', () => {
    setup(room)
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-option-room')).toHaveTextContent(
      'if no other cue comes right after',
    )
  })
})

describe('CueRuleRow condition line', () => {
  it('says under the sentence what the chosen condition does, the same words the list gives it', () => {
    setup({ ...RULE, when: 'previous' })
    const line = screen.getByTestId('cue-rule-0-when-line').textContent
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(line).toBe(screen.getByTestId('cue-rule-0-when-option-previous-hint').textContent)
    expect(line).not.toBe('')
  })

  it('follows the condition when the rule changes, so the line never describes the old one', () => {
    const { rerender } = render(
      <CueRuleRow
        rule={{ ...RULE, when: 'fits' }}
        index={1}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    const before = screen.getByTestId('cue-rule-1-when-line').textContent
    rerender(
      <CueRuleRow
        rule={{ ...RULE, when: 'clear' }}
        index={1}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByTestId('cue-rule-1-when-line').textContent).not.toBe(before)
  })
})

describe('CueRuleRow open menu', () => {
  it('closes on a press anywhere outside the menu, even on the same rule, so it never stays over the text', () => {
    setup(RULE)
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(screen.getByTestId('cue-rule-0-when-line'))
    expect(screen.queryByTestId('cue-rule-0-from-menu')).not.toBeInTheDocument()
  })

  it('stays open while the press lands inside the menu, so picking an option still works', () => {
    setup(RULE)
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(screen.getByTestId('cue-rule-0-from-menu'))
    expect(screen.getByTestId('cue-rule-0-from-menu')).toBeInTheDocument()
  })
})
