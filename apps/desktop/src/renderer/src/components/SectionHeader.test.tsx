// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

describe('SectionHeader folded row', () => {
  function header(over: Partial<React.ComponentProps<typeof SectionHeader>> = {}) {
    const onToggle = vi.fn()
    render(
      <SectionHeader
        title="TRIM"
        open={false}
        onToggle={onToggle}
        summary="Removes 3.6 s of silence at the end"
        summaryTestId="trim-row-sentence"
        help="What trim does"
        right={<span data-testid="pill">pill</span>}
        foldedRow
        {...over}
      />,
    )
    return { onToggle }
  }

  it('reads as the sentence alone while folded, with no switch, pill or help note', () => {
    header()
    expect(screen.getByTestId('trim-row-sentence')).toHaveTextContent('Removes 3.6 s')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('section-help')).not.toBeInTheDocument()
  })

  it('keeps the extras once open', () => {
    header({ open: true })
    expect(screen.getByTestId('pill')).toBeInTheDocument()
    expect(screen.getByTestId('section-help')).toBeInTheDocument()
  })
})
