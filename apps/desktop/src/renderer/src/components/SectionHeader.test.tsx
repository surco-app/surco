// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { SectionHeader } from './SectionHeader'

afterEach(cleanup)

describe('SectionHeader folded summary', () => {
  // A section that's switched off ("Off"/"None") is noise while scanning: the eye wants
  // to land on the sections carrying real figures (~11 clicks, 138 BPM, -9.5 LUFS). A
  // muted summary steps the off-states back a shade so the live ones read first.
  it('dims an off-state summary more than a live one', () => {
    const { rerender } = render(
      <SectionHeader
        title="LOUDNESS"
        open={false}
        onToggle={() => {}}
        summary="None"
        summaryTestId="s"
        summaryMuted
      />,
    )
    const muted = screen.getByTestId('s').className
    expect(muted).toContain('text-fg-faint')

    rerender(
      <SectionHeader
        title="LOUDNESS"
        open={false}
        onToggle={() => {}}
        summary="-9.5 LUFS · 0.8 dBTP"
        summaryTestId="s"
      />,
    )
    const live = screen.getByTestId('s').className
    expect(live).not.toContain('text-fg-faint')
  })

  it('shows no summary while the section is open', () => {
    render(
      <SectionHeader
        title="LOUDNESS"
        open
        onToggle={() => {}}
        summary="None"
        summaryTestId="s"
        summaryMuted
      />,
    )
    expect(screen.queryByTestId('s')).toBeNull()
  })
})

describe('SectionHeader switch row', () => {
  function header(over: Partial<React.ComponentProps<typeof SectionHeader>> = {}) {
    const onToggle = vi.fn()
    const onSwitch = vi.fn()
    render(
      <SectionHeader
        title="TRIM"
        open={false}
        onToggle={onToggle}
        summary="Removes 3.6 s of silence at the end"
        summaryTestId="trim-row-sentence"
        help="What trim does"
        right={<span data-testid="pill">pill</span>}
        toggle={{ checked: false, onChange: onSwitch, testId: 'section-switch' }}
        {...over}
      />,
    )
    return { onToggle, onSwitch }
  }

  // Folded, the audio sections read as one row: a switch and what will happen. Pills,
  // badges and the help note were a second vocabulary for the same fact.
  it('reads as the sentence and the switch alone while folded', () => {
    header()
    expect(screen.getByTestId('trim-row-sentence')).toHaveTextContent('Removes 3.6 s')
    expect(screen.getByRole('switch', { name: 'TRIM' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('section-help')).not.toBeInTheDocument()
  })

  // The switch acts on the conversion; folding is a different question. A click that did
  // both would open a tool the user only meant to turn on.
  it('flips the switch without folding or unfolding the section', () => {
    const { onToggle, onSwitch } = header()
    fireEvent.click(screen.getByTestId('section-switch'))
    expect(onSwitch).toHaveBeenCalledWith(true)
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'TRIM' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  // A switch with nothing to act on stays in place, disabled, so the row never changes
  // shape between tracks.
  it('keeps a switch with nothing to do on screen but disabled', () => {
    const { onSwitch } = header({
      toggle: { checked: false, disabled: true, onChange: vi.fn(), testId: 'section-switch' },
    })
    expect(screen.getByTestId('section-switch')).toBeDisabled()
    fireEvent.click(screen.getByTestId('section-switch'))
    expect(onSwitch).not.toHaveBeenCalled()
  })

  // Open, the full tool is below: the header keeps the switch and its usual extras.
  it('keeps the switch and the extras once open', () => {
    header({ open: true })
    expect(screen.getByTestId('section-switch')).toBeInTheDocument()
    expect(screen.getByTestId('pill')).toBeInTheDocument()
    expect(screen.getByTestId('section-help')).toBeInTheDocument()
  })
})
