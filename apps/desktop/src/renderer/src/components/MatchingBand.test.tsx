// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { MatchingBand } from './MatchingBand'

afterEach(cleanup)

describe('MatchingBand', () => {
  it('turns the paired tracks into a playlist the DJ can take to the booth', () => {
    const onCreate = vi.fn()
    render(<MatchingBand tracks={4} onCreate={onCreate} />)
    fireEvent.click(screen.getByTestId('matching-create-playlist'))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  // Stays in place so the list does not jump the first time the DJ pairs two tracks.
  it('keeps the button but disables it while there is nothing paired', () => {
    render(<MatchingBand tracks={0} onCreate={vi.fn()} />)
    expect(screen.getByTestId('matching-create-playlist')).toBeDisabled()
  })
})
