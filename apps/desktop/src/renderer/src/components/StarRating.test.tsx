// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
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

  // Rating a track is a rare, deliberate act, so the star that receives the click gets a
  // small punch to acknowledge it. Only that one: hover already fills the row as a preview,
  // so punching every filled star would fire the flourish on a pointer merely crossing the
  // control, and repeat it five times over for a five-star rating.
  it('punches only the star that was clicked', () => {
    render(<StarRating value="" onChange={() => {}} />)
    fireEvent.click(screen.getByTestId('star-3'))
    expect(screen.getByTestId('star-3').className).toContain('star-punch')
    expect(screen.getByTestId('star-2').className).not.toContain('star-punch')
    expect(screen.getByTestId('star-4').className).not.toContain('star-punch')
  })

  // Clicking the top filled star clears the rating. That is an undo, and celebrating an
  // erasure reads as the app congratulating the user for removing their own data.
  it('does not punch when the click clears the rating', () => {
    render(<StarRating value="3" onChange={() => {}} />)
    fireEvent.click(screen.getByTestId('star-3'))
    expect(screen.getByTestId('star-3').className).not.toContain('star-punch')
  })

  // Hovering is not a commitment — it must leave the flourish alone, or the animation
  // fires every time the pointer sweeps across the row on its way somewhere else.
  it('does not punch on hover alone', () => {
    render(<StarRating value="" onChange={() => {}} />)
    fireEvent.mouseEnter(screen.getByTestId('star-4'))
    expect(screen.getByTestId('star-4').className).not.toContain('star-punch')
  })
})
