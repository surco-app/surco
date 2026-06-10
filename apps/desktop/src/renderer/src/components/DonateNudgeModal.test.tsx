// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { DONATE_URL } from '../lib/donate'
import { DonateNudgeModal } from './DonateNudgeModal'

afterEach(cleanup)

describe('DonateNudgeModal', () => {
  // The nudge earns its interruption by showing the user their own numbers — the
  // same conversions/time-saved summary as Settings → Stats, not a bare ask.
  it('summarizes the conversions and the time saved', () => {
    render(<DonateNudgeModal conversionCount={120} onClose={vi.fn()} />)
    expect(screen.getByTestId('donate-nudge-count')).toHaveTextContent('120')
    // 120 conversions × 4 min = 8 h, formatted by the shared stats helper.
    expect(screen.getByTestId('donate-nudge-time')).toHaveTextContent('8 h')
  })

  it('links the donate button to the PayPal page in an external tab', () => {
    render(<DonateNudgeModal conversionCount={10} onClose={vi.fn()} />)
    const cta = screen.getByTestId('donate-nudge-cta')
    expect(cta).toHaveAttribute('href', DONATE_URL)
    expect(cta).toHaveAttribute('target', '_blank')
  })

  // Closing normally must stay cheap and repeatable; only the explicit checkbox
  // silences the nudge forever — that promise is the whole reason it's not nagware.
  it('closes without dismissing unless the checkbox is ticked', () => {
    const onClose = vi.fn()
    render(<DonateNudgeModal conversionCount={10} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('donate-nudge-close'))
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('reports the permanent dismissal when the checkbox is ticked on close', () => {
    const onClose = vi.fn()
    render(<DonateNudgeModal conversionCount={10} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('donate-nudge-dismiss'))
    fireEvent.click(screen.getByTestId('donate-nudge-close'))
    expect(onClose).toHaveBeenCalledWith(true)
  })
})
