// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { StarRating } from './StarRating'

afterEach(cleanup)

describe('StarRating', () => {
  // The hover fills stars as a preview of what a click would set, but the committed
  // rating is what matters to assistive tech — aria-checked must keep reporting the
  // stored value so a screen reader never announces a rating the user only hovered.
  it('keeps aria-checked on the committed rating while another star is hovered', () => {
    render(<StarRating value="2" onChange={() => {}} />)
    fireEvent.mouseEnter(screen.getByTestId('star-4'))
    expect(screen.getByTestId('star-2')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('star-4')).toHaveAttribute('aria-checked', 'false')
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

  // Five buttons named "1 stars".."5 stars" floated free of any label: a screen reader
  // heard a run of star counts with nothing saying what they rate. They form one group
  // named by the form's "Rating" caption, and the singular reads as a singular.
  it('groups the stars under the label it is given', () => {
    render(
      <>
        <span id="rating-label">Rating</span>
        <StarRating value="" onChange={() => {}} labelledBy="rating-label" />
      </>,
    )
    const group = screen.getByRole('radiogroup', { name: 'Rating' })
    expect(group).toContainElement(screen.getByTestId('star-1'))
  })

  it('names one star in the singular and the rest in the plural', () => {
    render(<StarRating value="" onChange={() => {}} />)
    expect(screen.getByTestId('star-1')).toHaveAccessibleName('1 star')
    expect(screen.getByTestId('star-2')).toHaveAccessibleName('2 stars')
  })

  // Five tab stops made the rating the slowest field to cross, and the arrows did nothing.
  // A radio group is one stop, and the arrows move the rating the way a screen reader says.
  it('is a single tab stop on the committed star', () => {
    render(<StarRating value="3" onChange={() => {}} />)
    expect(screen.getByTestId('star-3')).toHaveAttribute('tabindex', '0')
    for (const n of [1, 2, 4, 5]) {
      expect(screen.getByTestId(`star-${n}`)).toHaveAttribute('tabindex', '-1')
    }
  })

  it('enters the group on the first star when nothing is rated', () => {
    render(<StarRating value="" onChange={() => {}} />)
    expect(screen.getByTestId('star-1')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('star-2')).toHaveAttribute('tabindex', '-1')
  })

  it('exposes the stars as radios', () => {
    render(<StarRating value="2" onChange={() => {}} />)
    expect(screen.getAllByRole('radio')).toHaveLength(5)
    expect(screen.getByRole('radio', { name: '2 stars' })).toBeChecked()
  })

  it('moves the rating and the focus with the arrow keys', () => {
    const onChange = vi.fn()
    render(<StarRating value="3" onChange={onChange} />)
    screen.getByTestId('star-3').focus()
    fireEvent.keyDown(screen.getByTestId('star-3'), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('4')
    expect(screen.getByTestId('star-4')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('star-4'), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('3')
  })

  it('stops at the first and the last star instead of wrapping', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StarRating value="5" onChange={onChange} />)
    fireEvent.keyDown(screen.getByTestId('star-5'), { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
    rerender(<StarRating value="1" onChange={onChange} />)
    fireEvent.keyDown(screen.getByTestId('star-1'), { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the arrow inside the stars at either end, so the track list behind never moves to another track', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StarRating value="5" onChange={onChange} />)
    expect(fireEvent.keyDown(screen.getByTestId('star-5'), { key: 'ArrowRight' })).toBe(false)
    expect(fireEvent.keyDown(screen.getByTestId('star-5'), { key: 'ArrowUp' })).toBe(false)
    rerender(<StarRating value="1" onChange={onChange} />)
    expect(fireEvent.keyDown(screen.getByTestId('star-1'), { key: 'ArrowLeft' })).toBe(false)
    expect(fireEvent.keyDown(screen.getByTestId('star-1'), { key: 'ArrowDown' })).toBe(false)
    rerender(<StarRating value="" onChange={onChange} />)
    expect(fireEvent.keyDown(screen.getByTestId('star-1'), { key: 'ArrowLeft' })).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('gives one star on the first step up from no rating, since the first star is the lowest rating there is', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StarRating value="" onChange={onChange} />)
    fireEvent.keyDown(screen.getByTestId('star-1'), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('1')
    expect(screen.getByTestId('star-1')).toHaveFocus()
    onChange.mockClear()
    rerender(<StarRating value="" onChange={onChange} />)
    fireEvent.keyDown(screen.getByTestId('star-1'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('1')
  })

  it('still clears the rating when the current star is clicked', () => {
    const onChange = vi.fn()
    render(<StarRating value="3" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('star-3'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  // A 16 px star is under the 24 px pointer target. The stars sit 18 px apart, so the press
  // area grows to the full 24 px in height and to the pitch in width, without overlapping.
  it('gives every star a taller press area than its drawing', () => {
    render(<StarRating value="" onChange={() => {}} />)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`star-${n}`).className).toContain('after:-inset-y-1')
    }
  })
})
