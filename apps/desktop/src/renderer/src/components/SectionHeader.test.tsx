// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { SectionGroupHeading } from './SectionGroupHeading'
import { SectionHeader } from './SectionHeader'
import { SectionSubhead } from './SectionSubhead'

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

// The editor is a long single scroll of phases, sections and captions that only looked
// like headings, so a screen reader's heading list (the way its users skim a page) was
// empty and every section had to be found by tabbing. Phase, section and caption now sit
// at levels 2, 3 and 4, so the outline mirrors what the eye sees.
describe('editor heading outline', () => {
  it('makes each section toggle a level-3 heading named by its title', () => {
    render(<SectionHeader title="TRIM" open={false} onToggle={() => {}} summary="Off" />)
    const heading = screen.getByRole('heading', { level: 3, name: /^TRIM/ })
    expect(heading).toContainElement(screen.getByRole('button', { name: 'TRIM' }))
  })

  it('makes each phase label a level-2 heading', () => {
    render(<SectionGroupHeading label="Audio" testid="group-audio" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Audio' })).toBeInTheDocument()
  })

  it('makes each caption inside a section a level-4 heading', () => {
    render(<SectionSubhead>Loudness</SectionSubhead>)
    expect(screen.getByRole('heading', { level: 4, name: 'Loudness' })).toBeInTheDocument()
  })
})
