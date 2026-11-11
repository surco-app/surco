import { afterEach, describe, expect, it, vi } from 'vitest'
import { onFeedbackRequested, openFeedback } from './feedback'

let unsubscribe = () => {}
afterEach(() => unsubscribe())

describe('openFeedback', () => {
  it('reaches the dialog opener with the error and stack, so the menu, palette and failed conversions all land in the same dialog', () => {
    const open = vi.fn()
    unsubscribe = onFeedbackRequested(open)
    openFeedback('boom', 'at x')
    expect(open).toHaveBeenCalledWith('boom', 'at x')
  })

  it('stops reaching an opener once it unsubscribes', () => {
    const open = vi.fn()
    onFeedbackRequested(open)()
    openFeedback()
    expect(open).not.toHaveBeenCalled()
  })
})
