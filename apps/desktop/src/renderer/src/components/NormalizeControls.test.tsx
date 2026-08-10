// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig } from '../../../shared/types'
import '../i18n'
import { NormalizeControls } from './NormalizeControls'

afterEach(cleanup)

const loudness: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

// The controls are a controlled component, so the reveal test drives them like the
// Settings tab does: mode changes come back through onChange and re-render as value.
function Harness({ initial }: { initial: NormalizeConfig }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return <NormalizeControls value={value} onChange={setValue} />
}

describe('NormalizeControls reveal', () => {
  // Switching the mode on reveals the target fields BELOW the segmented control — at
  // the bottom of a scrolling Settings tab they land under the fold, so the scrollbar
  // moves but nothing visibly changes. Scrolling the revealed block into view is what
  // makes the click feel like it did something.
  it('scrolls the revealed fields into view when a mode is switched on', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<Harness initial={{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }} />)
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('normalize-mode-loudness'))
    expect(scroll).toHaveBeenCalled()
  })

  // Mounting with a mode already active (the editor reopening a configured track, the
  // Settings tab re-opening) is not a reveal — auto-scrolling there would yank the view.
  it('does not scroll on mount when a mode is already active', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<Harness initial={loudness} />)
    expect(scroll).not.toHaveBeenCalled()
  })
})

describe('NormalizeControls number input', () => {
  // Every meaningful value here is negative (-14 LUFS, -1 dBTP). A controlled number
  // input that only commits finite parses snaps back on clear, so the user literally
  // cannot delete-and-retype — the draft must live in the field until it parses.
  it('lets the user clear the field and type a new negative value', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={loudness} onChange={onChange} />)
    const input = screen.getByTestId('normalize-target-lufs') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: '-9' } })
    expect(onChange).toHaveBeenCalledWith({ ...loudness, targetLufs: -9 })
  })

  // An abandoned draft (cleared, then focus moved on) must fall back to the committed
  // figure rather than leaving the field empty over a value that is still in effect.
  it('restores the committed value when the field is left empty', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={loudness} onChange={onChange} />)
    const input = screen.getByTestId('normalize-target-lufs') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(input.value).toBe('-14')
    expect(onChange).not.toHaveBeenCalled()
  })
})

// Djotas's Audacity habit, verbatim: peak to a target plus per-channel DC removal
// and independent channel gains. Per-channel gain belongs to peak mode (it trades the
// stereo image for both channels hitting the target), but centring does not: a user
// reported wanting to fix a biased vinyl capture AND normalize to a loudness target, and
// had to choose. Subtracting the mean is a correction of the signal; the mode only
// decides how the gain is sized afterwards.
describe('NormalizeControls peak options', () => {
  const peak: NormalizeConfig = { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

  it('offers independent channel gains in peak mode', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={peak} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('normalize-peak-per-channel'))
    expect(onChange).toHaveBeenCalledWith({ ...peak, peakPerChannel: true })
  })

  it('shows a saved per-channel choice as checked', () => {
    render(<NormalizeControls value={{ ...peak, peakPerChannel: true }} onChange={vi.fn()} />)
    expect(screen.getByTestId('normalize-peak-per-channel')).toBeChecked()
  })

  it('keeps the per-channel option out of loudness mode', () => {
    render(<NormalizeControls value={loudness} onChange={vi.fn()} />)
    expect(screen.queryByTestId('normalize-peak-per-channel')).not.toBeInTheDocument()
  })
})

describe('NormalizeControls field help', () => {
  // The per-term hover tooltips are gone on purpose: their dotted affordance was
  // invisible at this size on the dark ground, and making it visible read as noise to
  // the fluent user. Help lives in the two layers that work for both audiences — the
  // ever-visible preset line for context, and the header ⓘ modal for definitions —
  // so the fields themselves must stay completely quiet.
  it('keeps the fields silent — no tooltip on focus or hover', () => {
    vi.useFakeTimers()
    render(<NormalizeControls value={loudness} onChange={vi.fn()} />)
    fireEvent.focusIn(screen.getByTestId('normalize-target-lufs'))
    fireEvent.pointerEnter(screen.getByTestId('normalize-target-lufs'), {
      clientX: 10,
      clientY: 40,
    })
    fireEvent.pointerEnter(screen.getByText('Target (LUFS)'), { clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  // The chosen preset explains itself in one line, keyed to the selection — the
  // passive layer of teaching that interrupts nobody.
  it('describes the active preset under the chips', () => {
    render(
      <NormalizeControls
        value={{ mode: 'loudness', targetLufs: -23, truePeakDb: -1, peakDb: -1 }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('normalize-preset-hint')).toHaveTextContent(/TV and radio/)
  })
})

describe('NormalizeControls DC offset', () => {
  const peak: NormalizeConfig = { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

  // The reported bug: picking loudness silently dropped the centring, because the box
  // lived inside the peak block. Both modes have to offer it.
  it('offers DC removal in loudness mode', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={loudness} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('normalize-remove-dc'))
    expect(onChange).toHaveBeenCalledWith({ ...loudness, removeDcOffset: true })
  })

  it('offers DC removal in peak mode too', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={peak} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('normalize-remove-dc'))
    expect(onChange).toHaveBeenCalledWith({ ...peak, removeDcOffset: true })
  })

  it('shows a saved choice as checked in either mode', () => {
    render(<NormalizeControls value={{ ...loudness, removeDcOffset: true }} onChange={vi.fn()} />)
    expect(screen.getByTestId('normalize-remove-dc')).toBeChecked()
  })

  // With mode none the pipeline applies no filter at all (normalizeFilter bails before
  // reading removeDcOffset), so a visible box there promises a correction that never
  // happens — the reported confusion: "why is it on the None tab?".
  it('hides DC removal in none mode, where it would do nothing', () => {
    const none: NormalizeConfig = { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    render(<NormalizeControls value={none} onChange={vi.fn()} />)
    expect(screen.queryByTestId('normalize-remove-dc')).not.toBeInTheDocument()
  })
})
