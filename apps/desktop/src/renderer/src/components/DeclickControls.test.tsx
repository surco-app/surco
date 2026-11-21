// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { DeclickControls, NoiseControls } from './DeclickControls'

afterEach(cleanup)

describe('DeclickControls', () => {
  it('offers the whole intensity ladder and reports the pick through onChange', () => {
    const onChange = vi.fn()
    render(<DeclickControls value="off" onChange={onChange} />)
    expect(screen.getByTestId('declick-mode-soft')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(onChange).toHaveBeenCalledWith('standard')
  })

  // Every step explains itself under the control, off included, like the noise ladder
  // beside it: off says what clicks are, the moment someone is deciding whether they have
  // them, and a hint that only exists once a step is picked leaves the two ladders unaligned.
  it('explains every step, off included, the way the noise ladder beside it does', () => {
    const { rerender } = render(<DeclickControls value="off" onChange={() => {}} />)
    expect(screen.getByTestId('declick-mode-hint')).toHaveTextContent(
      i18n.t('declick.modeHint.off'),
    )
    rerender(<DeclickControls value="strong" onChange={() => {}} />)
    expect(screen.getByTestId('declick-mode-hint')).toHaveTextContent(
      i18n.t('declick.modeHint.strong'),
    )
  })

  // No raw ffmpeg strings in the UI — the ladder labels are the whole vocabulary a
  // user needs (the filter mapping lives in shared/declick.ts for the tests).
  it('never surfaces the underlying filter string', () => {
    render(<DeclickControls value="strong" onChange={() => {}} />)
    expect(screen.queryByTestId('declick-applied')).not.toBeInTheDocument()
    expect(screen.queryByText(/adeclick/)).not.toBeInTheDocument()
  })
})

// The picker is four bare words ("Off", "Gentle"...). Without a group name a screen
// reader lands on "Gentle, toggle button" with nothing saying what is gentle, in the
// editor where no settings label sits above it.
describe('DeclickControls group name', () => {
  it('names the intensity ladder after the repair it sets', () => {
    render(<DeclickControls value="off" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Clicks' })).toBeInTheDocument()
  })

  // Two ladders with the same four words now sit in one section; each needs its own name.
  it('names the background-noise ladder apart from the click one', () => {
    render(<NoiseControls value="off" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Background noise' })).toBeInTheDocument()
  })
})

// The inline-explanations switch in Settings promises to hide what each mode does; a step
// hint that stayed on with it off made the switch look broken to whoever turned it off.
describe('DeclickControls inline explanations', () => {
  it('drops both ladder hints when the explanations are off', () => {
    render(
      <>
        <DeclickControls value="soft" onChange={() => {}} showHints={false} />
        <NoiseControls value="soft" onChange={() => {}} showHints={false} />
      </>,
    )
    expect(screen.queryByTestId('declick-mode-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('declick-noise-hint')).not.toBeInTheDocument()
    expect(screen.getByTestId('declick-mode-soft')).toBeInTheDocument()
  })

  it('keeps both ladder hints when the explanations are on', () => {
    render(
      <>
        <DeclickControls value="soft" onChange={() => {}} showHints />
        <NoiseControls value="soft" onChange={() => {}} showHints />
      </>,
    )
    expect(screen.getByTestId('declick-mode-hint')).toHaveTextContent(
      i18n.t('declick.modeHint.soft'),
    )
    expect(screen.getByTestId('declick-noise-hint')).toHaveTextContent(
      i18n.t('declick.noiseHint.soft'),
    )
  })
})
