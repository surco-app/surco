// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'
import { useState } from 'react'
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
// and independent channel gains. They only make sense in peak mode — loudness
// (loudnorm) has its own gating math — so the boxes live in the peak block alone.
describe('NormalizeControls peak options', () => {
  const peak: NormalizeConfig = { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

  it('offers DC removal and independent channels in peak mode', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={peak} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('normalize-peak-remove-dc'))
    expect(onChange).toHaveBeenCalledWith({ ...peak, peakRemoveDc: true })
    fireEvent.click(screen.getByTestId('normalize-peak-per-channel'))
    expect(onChange).toHaveBeenCalledWith({ ...peak, peakPerChannel: true })
  })

  it('shows the saved options as checked', () => {
    render(
      <NormalizeControls value={{ ...peak, peakRemoveDc: true }} onChange={vi.fn()} />,
    )
    expect(screen.getByTestId('normalize-peak-remove-dc')).toBeChecked()
    expect(screen.getByTestId('normalize-peak-per-channel')).not.toBeChecked()
  })

  it('keeps the options out of loudness mode', () => {
    render(<NormalizeControls value={loudness} onChange={vi.fn()} />)
    expect(screen.queryByTestId('normalize-peak-remove-dc')).not.toBeInTheDocument()
  })
})
