// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionBody } from './SectionBody'

afterEach(cleanup)

describe('SectionBody', () => {
  // The heavy body (spectrum decode, waveform) is gated on `open` by each section's own
  // hooks; SectionBody must not mount its children until the section is opened, so a folded
  // panel pays nothing.
  it('does not render children while closed', () => {
    render(
      <SectionBody open={false}>
        <p data-testid="body">heavy</p>
      </SectionBody>,
    )
    expect(screen.queryByTestId('body')).toBeNull()
  })

  it('renders children once opened', () => {
    render(
      <SectionBody open>
        <p data-testid="body">heavy</p>
      </SectionBody>,
    )
    expect(screen.getByTestId('body')).toBeInTheDocument()
  })

  // Closing animates out: the children stay mounted through the transition, then unmount on
  // transitionend, so the collapse is seen rather than snapping to nothing instantly.
  it('keeps children mounted through the close transition, then drops them', () => {
    const { rerender } = render(
      <SectionBody open>
        <p data-testid="body">heavy</p>
      </SectionBody>,
    )
    rerender(
      <SectionBody open={false}>
        <p data-testid="body">heavy</p>
      </SectionBody>,
    )
    // Still present mid-transition.
    expect(screen.getByTestId('body')).toBeInTheDocument()
    // The wrapper unmounts the body on the max-height transition finishing. jsdom doesn't
    // run transitions, so fire the end event by hand — with propertyName set, since the
    // handler only reacts to the height track (opacity/transform end events must not
    // trigger the unmount early).
    act(() => {
      const evt = new Event('transitionend', { bubbles: true }) as Event & {
        propertyName: string
      }
      evt.propertyName = 'max-height'
      screen.getByTestId('section-body').dispatchEvent(evt)
    })
    expect(screen.queryByTestId('body')).toBeNull()
  })

  // Under reduced-motion there is no transition, so transitionend never fires — the body
  // must still unmount on close instead of lingering forever. matchMedia is stubbed to
  // report the preference.
  it('unmounts immediately on close when motion is reduced', () => {
    const mql = { matches: true, media: '', addEventListener() {}, removeEventListener() {} }
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    )
    try {
      const { rerender } = render(
        <SectionBody open>
          <p data-testid="body">heavy</p>
        </SectionBody>,
      )
      rerender(
        <SectionBody open={false}>
          <p data-testid="body">heavy</p>
        </SectionBody>,
      )
      expect(screen.queryByTestId('body')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('exposes the open state on the wrapper for styling and tests', () => {
    render(
      <SectionBody open>
        <p>x</p>
      </SectionBody>,
    )
    expect(screen.getByTestId('section-body')).toHaveAttribute('data-open', 'true')
  })
})
