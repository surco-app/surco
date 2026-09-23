// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
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

describe('SectionHeader folded row', () => {
  function header(over: Partial<React.ComponentProps<typeof SectionHeader>> = {}) {
    render(
      <SectionHeader
        title="TRIM"
        open={false}
        onToggle={() => {}}
        summary="Removes 3.6 s of silence at the end"
        summaryTestId="trim-row-sentence"
        help="What trim does"
        right={<span data-testid="pill">pill</span>}
        {...over}
      />,
    )
  }

  // A folded section is read in one glance: the sentence says what it will do, the pill
  // carries the figure, and the help note says what the section is for.
  it('reads as the sentence, its pill and its help note while folded', () => {
    header()
    expect(screen.getByTestId('trim-row-sentence')).toHaveTextContent('Removes 3.6 s')
    expect(screen.getByTestId('pill')).toBeInTheDocument()
    expect(screen.getByTestId('section-help')).toBeInTheDocument()
  })

  it('keeps the extras once open', () => {
    header({ open: true })
    expect(screen.getByTestId('pill')).toBeInTheDocument()
    expect(screen.getByTestId('section-help')).toBeInTheDocument()
  })
})
