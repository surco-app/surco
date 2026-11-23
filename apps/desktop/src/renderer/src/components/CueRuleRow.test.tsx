// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  // The grey line under each rule told what its condition would do with perfect analysis:
  // choruses Surco only knows from rekordbox, phrases the other programs never give. It read
  // as a promise the track could break, so the rule shows only what the DJ chose, and what
  // a condition does is said where it is picked, in the list.
  it('puts no explanation under the rule, only in the list where the condition is picked', () => {
    setup({ ...RULE, when: 'previous', whenEach: ['fits', 'rule', 'down'] })
    const hint = i18n.t('settings.cueFlows.whenHint.previous')
    expect(screen.getByTestId('cue-rule-0')).not.toHaveTextContent(hint)
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-option-previous-hint')).toHaveTextContent(hint)
  })

  // Choruses and phrases come from rekordbox alone; a hint that spoke of choruses as if Surco
  // heard them claimed something untrue for Engine, Serato, Traktor and VirtualDJ.
  it('names rekordbox as where the choruses come from, in every language', async () => {
    try {
      for (const lng of ['es', 'en', 'de', 'fr', 'pt-BR', 'ca', 'it', 'ja']) {
        await i18n.changeLanguage(lng)
        for (const when of ['fits', 'previous'])
          expect(i18n.t(`settings.cueFlows.whenHint.${when}`)).toContain('rekordbox')
      }
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})

describe('CueRuleRow open menu', () => {
  it('closes on a press anywhere outside the menu, even on the same rule, so it never stays over the text', () => {
    setup(RULE)
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(screen.getByTestId('cue-rule-0'))
    expect(screen.queryByTestId('cue-rule-0-from-menu')).not.toBeInTheDocument()
  })

  it('stays open while the press lands inside the menu, so picking an option still works', () => {
    setup(RULE)
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(screen.getByTestId('cue-rule-0-from-menu'))
    expect(screen.getByTestId('cue-rule-0-from-menu')).toBeInTheDocument()
  })
})

describe('CueRuleRow menu between the two edges of Settings', () => {
  const rect = (left: number, width: number) =>
    ({
      left,
      right: left + width,
      width,
      top: 0,
      bottom: 0,
      height: 0,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  const openBetween = (anchorLeft: number) => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return rect(379, 534)
      if (this.getAttribute('data-testid') === 'cue-rule-0-color-2-palette') return rect(0, 304)
      return rect(anchorLeft, 25)
    })
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <CueRuleRow rule={RULE} index={0} onChange={vi.fn()} onRemove={vi.fn()} />
      </div>,
    )
    Object.defineProperty(screen.getByTestId('scroller'), 'clientWidth', { value: 525 })
    fireEvent.click(screen.getByTestId('cue-rule-0-color-2'))
    spy.mockRestore()
    return screen.getByTestId('cue-rule-0-color-2-palette')
  }

  it('slides a menu that fits on neither side of its square back inside the left edge of Settings, so its first colours are never cut', () => {
    const menu = openBetween(653)
    expect(menu).toHaveAttribute('data-align', 'right')
    expect(menu.style.right).toBe('-6px')
  })

  it('leaves a menu that fits towards the left hanging from the right edge of its square', () => {
    const menu = openBetween(700)
    expect(menu).toHaveAttribute('data-align', 'right')
    expect(menu.style.right).toBe('')
  })
})

describe('CueRuleRow condition of each repetition', () => {
  const box = (slot: number, name: string) =>
    screen.getByTestId(`cue-rule-0-color-${slot}-when-${name}`)
  const openSquare = (slot: number) =>
    fireEvent.click(screen.getByTestId(`cue-rule-0-color-${slot}`))
  const pickBars = (slot: number, side: string, bars: number) => {
    const testid = `cue-rule-0-color-${slot}-when-${side}-bars`
    fireEvent.click(screen.getByTestId(testid))
    fireEvent.click(screen.getByTestId(`${testid}-option-${bars}`))
  }
  const toggle = (slot: number, name: string) => {
    openSquare(slot)
    fireEvent.click(box(slot, name))
  }

  it('offers the conditions as boxes to tick under the colours of a repetition, with the ones it has ticked, so several can hold at once', () => {
    setup({ ...RULE, whenEach: ['rule', 'rule', 'fits+before:8+in:up|down'] })
    openSquare(2)
    const boxes = screen
      .getAllByRole('menuitemcheckbox')
      .map((el) => [
        el.getAttribute('data-testid')?.replace('cue-rule-0-color-2-when-', ''),
        el.getAttribute('aria-checked'),
      ])
    expect(boxes).toEqual([
      ['fits', 'true'],
      ['before', 'true'],
      ['after', 'false'],
      ['in-intro', 'false'],
      ['in-up', 'true'],
      ['in-down', 'true'],
      ['in-chorus', 'false'],
      ['in-outro', 'false'],
    ])
    expect(box(2, 'before')).toHaveTextContent('no cue before')
    expect(box(2, 'in-down')).toHaveTextContent('breakdown')
    expect(screen.getByTestId('cue-rule-0-color-2-when-only')).toHaveTextContent('Only in')
  })

  it('draws the box of a condition whether it is ticked or not, at one size, so one left off still reads as something to tick', () => {
    setup({ ...RULE, whenEach: ['rule', 'rule', 'fits'] })
    openSquare(2)
    const on = screen.getByTestId('cue-rule-0-color-2-when-fits-box')
    for (const name of ['before', 'after']) {
      const off = screen.getByTestId(`cue-rule-0-color-2-when-${name}-box`)
      expect(off.querySelector('svg')).toBeNull()
    }
    expect(on.querySelector('svg')).not.toBeNull()
  })

  it('offers them under a single colour too, where they hold for every repetition of the rule', () => {
    const fixed: CueRule = { ...RULE, color: { fixed: 22 } }
    const { onChange } = setup(fixed)
    toggle(0, 'fits')
    expect(onChange).toHaveBeenLastCalledWith({ ...fixed, whenEach: ['all:fits'] })
  })

  it('offers them on a cue placed on the same beat, which can also be told to keep away from other cues', () => {
    const single: CueRule = { ...RULE, bars: 0, repeat: 1 }
    const { onChange } = setup(single)
    toggle(0, 'before')
    expect(onChange).toHaveBeenLastCalledWith({ ...single, whenEach: ['all:before:32'] })
  })

  it('writes the condition at the repetition ticked and leaves the closer ones as the rule', () => {
    const { onChange } = setup(RULE)
    toggle(2, 'in-down')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'rule', 'down'] })
  })

  it('stays open after a box is ticked, since the next thing wanted is usually another box', () => {
    setup(RULE)
    toggle(2, 'fits')
    expect(screen.getByTestId('cue-rule-0-color-2-palette')).toBeInTheDocument()
    fireEvent.click(box(2, 'in-intro'))
    expect(screen.getByTestId('cue-rule-0-color-2-palette')).toBeInTheDocument()
  })

  it('still closes back on the square when a colour is picked, as it always did', () => {
    setup(RULE)
    openSquare(2)
    fireEvent.click(screen.getAllByTestId(/^cue-palette-\d+$/)[0])
    expect(screen.queryByTestId('cue-rule-0-color-2-palette')).not.toBeInTheDocument()
    expect(screen.getByTestId('cue-rule-0-color-2')).toHaveFocus()
  })

  it('shows the two neighbour conditions in a few words and keeps the whole sentence as their name and hint, so the short row loses no meaning', () => {
    setup(RULE)
    openSquare(2)
    expect(box(2, 'before').textContent).toBe('no cue before')
    expect(box(2, 'after').textContent).toBe('no cue after')
    expect(box(2, 'before')).toHaveAccessibleName('with no other cue in the bars before')
    expect(box(2, 'after')).toHaveAccessibleName('with no other cue in the bars after')
    fireEvent.focusIn(box(2, 'after'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('with no other cue in the bars after')
  })

  it('draws a section left off as a pill of its own too, so all five read as things to press and the ticked ones stand out by their fill', () => {
    setup({ ...RULE, whenEach: ['rule', 'rule', 'in:up|down'] })
    openSquare(2)
    expect(box(2, 'in-intro')).toHaveAttribute('aria-checked', 'false')
  })

  it('sets the five sections side by side in one row, each the same size ticked or not, so the menu is a row tall instead of five', () => {
    setup({ ...RULE, whenEach: ['rule', 'rule', 'in:up|down'] })
    openSquare(2)
    const row = screen.getByTestId('cue-rule-0-color-2-when-sections')
    const sections = ['intro', 'up', 'down', 'chorus', 'outro'].map((s) => box(2, `in-${s}`))
    expect(Array.from(row.children)).toEqual(sections)
    expect(sections.map((el) => el.textContent)).toEqual([
      'intro',
      'build',
      'breakdown',
      'chorus',
      'outro',
    ])
    expect(row.querySelector('svg')).toBeNull()
  })

  it('picks the bars from the menu of the app and never from a native select, which the system draws in its own colours', () => {
    setup(RULE)
    openSquare(1)
    const palette = screen.getByTestId('cue-rule-0-color-1-palette')
    expect(palette.querySelector('select')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-0-color-1-when-before-bars'))
    expect(document.querySelector('select')).toBeNull()
    expect(
      within(screen.getByTestId('cue-rule-0-color-1-when-before-bars-listbox'))
        .getAllByRole('option')
        .map((el) => el.textContent),
    ).toEqual(['1', '2', '4', '8', '12', '16', '24', '32', '48', '64', '96', '128'])
  })

  it('leaves the menu of the repetition open when a number of bars is picked, since the press lands on a list drawn outside it', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['rule', 'before:32'] })
    openSquare(1)
    const bars = screen.getByTestId('cue-rule-0-color-1-when-before-bars')
    fireEvent.click(bars)
    const option = screen.getByTestId('cue-rule-0-color-1-when-before-bars-option-8')
    expect(screen.getByTestId('cue-rule-0-color-1-palette')).not.toContainElement(option)
    fireEvent.mouseDown(option)
    fireEvent.click(option)
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'before:8'] })
    expect(screen.getByTestId('cue-rule-0-color-1-palette')).toBeInTheDocument()
    expect(bars).toHaveFocus()
  })

  it('still closes on a press outside once the list of bars is shut, so the guard for that list never leaves the menu stuck open', () => {
    setup(RULE)
    openSquare(1)
    pickBars(1, 'before', 8)
    fireEvent.mouseDown(screen.getByTestId('cue-rule-0'))
    expect(screen.queryByTestId('cue-rule-0-color-1-palette')).not.toBeInTheDocument()
  })

  it('closes the list of bars on the first Escape and the menu of the repetition on the second, one layer at a time', () => {
    setup(RULE)
    openSquare(1)
    const bars = screen.getByTestId('cue-rule-0-color-1-when-after-bars')
    fireEvent.click(bars)
    fireEvent.keyDown(screen.getByTestId('cue-rule-0-color-1-when-after-bars-option-16'), {
      key: 'Escape',
    })
    expect(screen.queryByTestId('cue-rule-0-color-1-when-after-bars-listbox')).toBeNull()
    expect(screen.getByTestId('cue-rule-0-color-1-palette')).toBeInTheDocument()
    expect(bars).toHaveFocus()
    fireEvent.keyDown(bars, { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-color-1-palette')).not.toBeInTheDocument()
    expect(screen.getByTestId('cue-rule-0-color-1')).toHaveFocus()
  })

  it('offers no Restablecer among the conditions of a square, where it read as clearing them when it only set the colour', () => {
    setup(RULE)
    openSquare(2)
    expect(screen.queryByTestId('cue-palette-reset')).toBeNull()
  })

  it('closes on Escape and gives the focus back to the square, so the keyboard never loses its place', () => {
    setup(RULE)
    toggle(2, 'fits')
    fireEvent.keyDown(box(2, 'fits'), { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-color-2-palette')).not.toBeInTheDocument()
    expect(screen.getByTestId('cue-rule-0-color-2')).toHaveFocus()
  })

  it('adds a condition to the ones the repetition already has instead of replacing them', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['rule', 'rule', 'down'] })
    toggle(2, 'in-up')
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'rule', 'in:up|down'] })
    fireEvent.click(box(2, 'fits'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...RULE,
      whenEach: ['rule', 'rule', 'fits+in:down'],
    })
  })

  it('asks for 32 bars clear before and 16 after unless told otherwise, the distances a countdown is usually built on', () => {
    const { onChange } = setup(RULE)
    openSquare(1)
    expect(screen.getByTestId('cue-rule-0-color-1-when-before-bars')).toHaveTextContent('32')
    expect(screen.getByTestId('cue-rule-0-color-1-when-after-bars')).toHaveTextContent('16')
    fireEvent.click(box(1, 'before'))
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'before:32'] })
    fireEvent.click(box(1, 'after'))
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'after:16'] })
  })

  it('changes the bars of a ticked condition at once', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['rule', 'before:32'] })
    openSquare(1)
    pickBars(1, 'before', 8)
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'before:8'] })
  })

  it('only remembers the bars of a condition not ticked yet, so choosing a number never switches it on', () => {
    const { onChange } = setup(RULE)
    openSquare(1)
    pickBars(1, 'after', 64)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('cue-rule-0-color-1-when-after-bars')).toHaveTextContent('64')
    fireEvent.click(box(1, 'after'))
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['rule', 'after:64'] })
  })

  it('saves no trailing repetitions that only follow the rule, so the same flow is always stored the same way', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['fits', 'rule', 'down'] })
    toggle(2, 'in-down')
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, whenEach: ['fits'] })
  })

  it('drops the field once every repetition is back to the rule, so the rule saves as it did before', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['rule', 'rule', 'down'] })
    toggle(2, 'in-down')
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('whenEach')
  })

  it('draws only the repetition with its own condition as an outline, so it stands out without a new label', () => {
    setup({ ...RULE, whenEach: ['rule', 'rule', 'down'] })
    const own = screen.getByTestId('cue-rule-0-color-2')
    expect(own).toHaveAttribute('data-own', 'true')
    expect(own.style.getPropertyValue('--cue')).toBe(hotCueColor(42))
    expect(own.style.backgroundColor).toBe('transparent')
    for (const slot of [0, 1]) {
      const plain = screen.getByTestId(`cue-rule-0-color-${slot}`)
      expect(plain).not.toHaveAttribute('data-own')
      expect(plain.style.backgroundColor).not.toBe('transparent')
    }
  })

  it('cuts the conditions of the repetitions a shorter rule no longer has, so none comes back when it grows again', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['fits', 'rule', 'down'] })
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat'))
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat-option-2'))
    expect(onChange).toHaveBeenLastCalledWith({ ...RULE, repeat: 2, whenEach: ['fits'] })
  })

  it('draws the single square of a one colour rule as an outline once it has conditions', () => {
    setup({ ...RULE, color: { fixed: 22 }, whenEach: ['all:before:32'] })
    expect(screen.getByTestId('cue-rule-0-color-0')).toHaveAttribute('data-own', 'true')
  })

  // With the line under the rule gone, the outline is all that marks a repetition with its
  // own conditions; a screen reader cannot see it, so the square names them.
  it('names every condition of a repetition on its square, joined the way the language joins a list', () => {
    setup({ ...RULE, whenEach: ['in:up|down', 'rule', 'fits+before:32+after:1'] })
    expect(screen.getByTestId('cue-rule-0-color-2')).toHaveAccessibleName(
      'Colour 3. Only if it fits, with no other cue in the 32 bars before, and with no other cue in the 1 bar after.',
    )
    expect(screen.getByTestId('cue-rule-0-color-0')).toHaveAccessibleName(
      'Colour 1. Only in a build or a breakdown.',
    )
    expect(screen.getByTestId('cue-rule-0-color-1')).toHaveAccessibleName('Colour 2')
  })

  it('names the conditions of a one colour rule on its single square', () => {
    setup({ ...RULE, color: { fixed: 22 }, whenEach: ['all:before:32'] })
    expect(screen.getByTestId('cue-rule-0-color-0')).toHaveAccessibleName(
      'Colour 1. Only with no other cue in the 32 bars before.',
    )
  })

  it('builds the sentence in the order each language needs, not the Spanish one', async () => {
    const line = async (lng: string) => {
      await i18n.changeLanguage(lng)
      cleanup()
      setup({ ...RULE, whenEach: ['rule', 'rule', 'fits+in:up|down'] })
      return screen.getByTestId('cue-rule-0-color-2').getAttribute('aria-label')
    }
    try {
      expect(await line('es')).toContain('Solo si cabe y en una subida o una bajada.')
      expect(await line('de')).toContain(
        'Nur wenn es passt und in einem Aufbau oder einem Breakdown.',
      )
      expect(await line('ja')).toContain('収まる場合、ビルドアップまたはブレイクダウンのみ。')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('keeps the conditions of the only repetition when the rule stops repeating, now said about the rule', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['before:32', 'rule', 'down'] })
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-0'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...RULE,
      bars: 0,
      repeat: 1,
      whenEach: ['all:before:32'],
    })
  })

  it('hands the conditions of a single cue to its first repetition when the rule starts repeating', () => {
    const single: CueRule = { ...RULE, bars: 0, repeat: 1, whenEach: ['all:before:32'] }
    const { onChange } = setup(single)
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-16'))
    expect(onChange).toHaveBeenLastCalledWith({ ...single, bars: 16, whenEach: ['before:32'] })
  })

  it('gives every square the conditions the single colour had when the rule goes to a colour per repetition, so nothing it asked for is lost', () => {
    const { onChange } = setup({ ...RULE, color: { fixed: 22 }, whenEach: ['all:before:32'] })
    fireEvent.click(screen.getByTestId('cue-rule-0-color-mode'))
    fireEvent.click(screen.getByTestId('cue-rule-0-color-mode-option-each'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...RULE,
      color: { each: [22, 22, 22] },
      whenEach: ['before:32', 'before:32', 'before:32'],
    })
  })

  it('keeps the conditions when the rule goes to one colour and every square had the same', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['fits', 'fits', 'fits'] })
    fireEvent.click(screen.getByTestId('cue-rule-0-color-mode'))
    fireEvent.click(screen.getByTestId('cue-rule-0-color-mode-option-fixed'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...RULE,
      color: { fixed: 1 },
      whenEach: ['all:fits'],
    })
  })

  it('drops every condition when the rule stops repeating and its first repetition had none, since the others are gone', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['rule', 'rule', 'down'] })
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-0'))
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('whenEach')
  })

  it('drops the conditions when the rule goes to one colour and the squares differed, since one square cannot say them all', () => {
    const { onChange } = setup({ ...RULE, whenEach: ['rule', 'rule', 'down'] })
    fireEvent.click(screen.getByTestId('cue-rule-0-color-mode'))
    fireEvent.click(screen.getByTestId('cue-rule-0-color-mode-option-fixed'))
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('whenEach')
  })
})
