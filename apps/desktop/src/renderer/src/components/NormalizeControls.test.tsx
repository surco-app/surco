// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig } from '../../../shared/types'
import '../i18n'
import { NormalizeControls } from './NormalizeControls'

afterEach(cleanup)

const loudness: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

describe('NormalizeControls number input', () => {
  // Every meaningful value here is negative (-14 LUFS, -1 dBTP). A controlled number
  // input that only commits finite parses snaps back on clear, so the user literally
  // cannot delete-and-retype — the draft must live in the field until it parses.
  it('lets the user clear the field and type a new negative value', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={loudness} onChange={onChange} />)
    const input = screen.getByTestId('normalize-target-lufs') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: '-9' } })
    expect(onChange).toHaveBeenCalledWith({ ...loudness, targetLufs: -9 })
  })

  // An abandoned draft (cleared, then focus moved on) must fall back to the committed
  // figure rather than leaving the field empty over a value that is still in effect.
  it('restores the committed value when the field is left empty', () => {
    const onChange = vi.fn()
    render(<NormalizeControls value={loudness} onChange={onChange} />)
    const input = screen.getByTestId('normalize-target-lufs') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(input.value).toBe('-14')
    expect(onChange).not.toHaveBeenCalled()
  })
})
