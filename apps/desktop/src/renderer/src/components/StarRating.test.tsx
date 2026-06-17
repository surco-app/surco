// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StarRating } from './StarRating'

afterEach(cleanup)

describe('StarRating', () => {
  // The hover fills stars as a preview of what a click would set, but the committed
  // rating is what matters to assistive tech — aria-pressed must keep reporting the
  // stored value so a screen reader never announces a rating the user only hovered.
  it('keeps aria-pressed on the committed rating while another star is hovered', () => {
    render(<StarRating value="2" onChange={() => {}} />)
    fireEvent.mouseEnter(screen.getByTestId('star-4'))
    expect(screen.getByTestId('star-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('star-4')).toHaveAttribute('aria-pressed', 'false')
  })

  it('sets the hovered rating on click', () => {
    const onChange = vi.fn()
    render(<StarRating value="" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('star-3'))
    expect(onChange).toHaveBeenCalledWith('3')
  })
})
