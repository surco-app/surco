// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { DeclickSection } from './DeclickSection'

afterEach(cleanup)

describe('DeclickSection', () => {
  it('badges the active mode only while folded', () => {
    const { rerender } = render(
      <DeclickSection value="standard" open={false} onToggle={() => {}} onChange={() => {}} />,
    )
    expect(screen.getByTestId('declick-active-badge')).toBeInTheDocument()
    // Open, the segmented control right below says the same thing.
    rerender(<DeclickSection value="standard" open onToggle={() => {}} onChange={() => {}} />)
    expect(screen.queryByTestId('declick-active-badge')).not.toBeInTheDocument()
  })

  it('shows no badge while folded and off', () => {
    render(<DeclickSection value="off" open={false} onToggle={() => {}} onChange={() => {}} />)
    expect(screen.queryByTestId('declick-active-badge')).not.toBeInTheDocument()
  })

  // A folded section that shows nothing is indistinguishable from one never looked
  // at — the header must state "Off" so the folded column stays scannable.
  it('summarizes the off state in the header while folded', () => {
    const { rerender } = render(
      <DeclickSection value="off" open={false} onToggle={() => {}} onChange={() => {}} />,
    )
    expect(screen.getByTestId('declick-summary')).toHaveTextContent('Off')
    // Open, the segmented control below already says it.
    rerender(<DeclickSection value="off" open onToggle={() => {}} onChange={() => {}} />)
    expect(screen.queryByTestId('declick-summary')).not.toBeInTheDocument()
    // Active, the accent badge is the state — a second "Standard" would be noise.
    rerender(
      <DeclickSection value="standard" open={false} onToggle={() => {}} onChange={() => {}} />,
    )
    expect(screen.queryByTestId('declick-summary')).not.toBeInTheDocument()
  })

  // The repair forces a re-encode (dropping cues on WAV/FLAC like normalization), so
  // the warning must appear exactly when a mode is active.
  it('warns about the re-encode only when a mode is active', () => {
    const { rerender } = render(
      <DeclickSection value="off" open onToggle={() => {}} onChange={() => {}} />,
    )
    expect(screen.queryByTestId('declick-cue-warning')).not.toBeInTheDocument()
    rerender(<DeclickSection value="strong" open onToggle={() => {}} onChange={() => {}} />)
    expect(screen.getByTestId('declick-cue-warning')).toBeInTheDocument()
  })

  it('reports mode picks up through onChange', () => {
    const onChange = vi.fn()
    render(<DeclickSection value="off" open onToggle={() => {}} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('declick-mode-strong'))
    expect(onChange).toHaveBeenCalledWith('strong')
  })
})
