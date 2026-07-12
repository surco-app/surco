// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { DeclickSection } from './DeclickSection'

afterEach(cleanup)

const play = vi.fn()
const pause = vi.fn()
beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  // jsdom has no audio pipeline; the audition only needs play/pause/onended.
  vi.stubGlobal(
    'Audio',
    class {
      onended: (() => void) | null = null
      play = play
      pause = pause
    },
  )
  ;(window as unknown as { api: unknown }).api = {
    declickPreview: vi.fn().mockResolvedValue({ path: '/tmp/removed.wav', share: 0.005 }),
  }
})

function section(over: Partial<React.ComponentProps<typeof DeclickSection>> = {}): React.JSX.Element {
  return (
    <DeclickSection
      value="off"
      open
      onToggle={() => {}}
      onChange={() => {}}
      inputPath="/in/track.wav"
      isMulti={false}
      {...over}
    />
  )
}

describe('DeclickSection', () => {
  it('badges the active mode only while folded', () => {
    const { rerender } = render(section({ value: 'standard', open: false }))
    expect(screen.getByTestId('declick-active-badge')).toBeInTheDocument()
    // Open, the segmented control right below says the same thing.
    rerender(section({ value: 'standard', open: true }))
    expect(screen.queryByTestId('declick-active-badge')).not.toBeInTheDocument()
  })

  it('shows no badge while folded and off', () => {
    render(section({ value: 'off', open: false }))
    expect(screen.queryByTestId('declick-active-badge')).not.toBeInTheDocument()
  })

  // A folded section that shows nothing is indistinguishable from one never looked
  // at — the header must state "Off" so the folded column stays scannable.
  it('summarizes the off state in the header while folded', () => {
    const { rerender } = render(section({ value: 'off', open: false }))
    expect(screen.getByTestId('declick-summary')).toHaveTextContent('Off')
    // Open, the segmented control below already says it.
    rerender(section({ value: 'off', open: true }))
    expect(screen.queryByTestId('declick-summary')).not.toBeInTheDocument()
    // Active, the accent badge is the state — a second "Standard" would be noise.
    rerender(section({ value: 'standard', open: false }))
    expect(screen.queryByTestId('declick-summary')).not.toBeInTheDocument()
  })

  // The repair forces a re-encode (dropping cues on WAV/FLAC like normalization), so
  // the warning must appear exactly when a mode is active.
  it('warns about the re-encode only when a mode is active', () => {
    const { rerender } = render(section({ value: 'off' }))
    expect(screen.queryByTestId('declick-cue-warning')).not.toBeInTheDocument()
    rerender(section({ value: 'strong' }))
    expect(screen.getByTestId('declick-cue-warning')).toBeInTheDocument()
  })

  it('reports mode picks up through onChange', () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    fireEvent.click(screen.getByTestId('declick-mode-strong'))
    expect(onChange).toHaveBeenCalledWith('strong')
  })

  // The audition renders one track's excerpt, so it only makes sense with a mode
  // active and a single track — off has nothing to remove, and in multi-select the
  // anchor's excerpt would misrepresent the rest.
  it('offers the audition only for an active mode on a single track', () => {
    const { rerender } = render(section({ value: 'off' }))
    expect(screen.queryByTestId('declick-audition')).not.toBeInTheDocument()
    rerender(section({ value: 'standard' }))
    expect(screen.getByTestId('declick-audition')).toBeInTheDocument()
    rerender(section({ value: 'standard', isMulti: true }))
    expect(screen.queryByTestId('declick-audition')).not.toBeInTheDocument()
  })

  it('renders the removed-clicks excerpt for the picked mode and plays it', async () => {
    render(section({ value: 'strong' }))
    await act(async () => {
      fireEvent.click(screen.getByTestId('declick-audition'))
    })
    expect(window.api.declickPreview).toHaveBeenCalledWith('/in/track.wav', 'strong')
    expect(play).toHaveBeenCalled()
  })

  // The near-silence the audition plays is baffling without a caption ("is this an
  // example?" — real user feedback): the touched share states the verdict outright,
  // as a fraction — a raw sample count on clean dense music reads as "broken file".
  it('captions the audition with the excerpt’s touched share', async () => {
    render(section({ value: 'standard' }))
    await act(async () => {
      fireEvent.click(screen.getByTestId('declick-audition'))
    })
    expect(screen.getByTestId('declick-audition-count')).toHaveTextContent('0.5%')
  })

  it('states a clean excerpt outright instead of showing a bare zero', async () => {
    ;(window.api.declickPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/tmp/removed.wav',
      share: 0,
    })
    render(section({ value: 'standard' }))
    await act(async () => {
      fireEvent.click(screen.getByTestId('declick-audition'))
    })
    expect(screen.getByTestId('declick-audition-count')).toHaveTextContent(/touch nothing/)
  })

  // A failed render must say so — a button that silently does nothing reads as
  // "there are no clicks", which is exactly the wrong conclusion.
  it('surfaces a failed render instead of staying silent', async () => {
    ;(window.api.declickPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(section({ value: 'standard' }))
    await act(async () => {
      fireEvent.click(screen.getByTestId('declick-audition'))
    })
    expect(screen.getByTestId('declick-audition-failed')).toBeInTheDocument()
  })
})
