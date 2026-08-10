// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

function renderControl(value = 'b'): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn()
  render(
    <SegmentedControl
      options={['a', 'b', 'c'] as const}
      value={value}
      onChange={onChange}
      testidPrefix="seg"
      labelFor={(id) => id.toUpperCase()}
    />,
  )
  return { onChange }
}

describe('SegmentedControl sliding highlight', () => {
  // The raised segment is a separate overlay clipped to the active option, so it can
  // TRAVEL between segments instead of teleporting — the visual claim that the row is
  // one setting moving between values. It duplicates every label, so it must be
  // invisible to assistive tech or each option would be announced twice.
  it('renders the highlight overlay hidden from assistive tech', () => {
    renderControl()
    const overlay = screen.getByTestId('seg-highlight')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
    expect(overlay).toHaveTextContent('ABC')
  })

  // The overlay is painted state, not a control: if it captured the pointer, clicks on
  // "the active segment's pixels" would hit the copy instead of the real button.
  it('keeps the overlay transparent to the pointer', () => {
    renderControl()
    expect(screen.getByTestId('seg-highlight').style.pointerEvents).toBe('none')
  })

  // Reported: a control that mounts before it has real geometry (a hidden step, a
  // modal mid-entrance) measured zeros, which as a clip means "everything raised" —
  // the highlight covered the whole track, then slid to the active segment when the
  // real measurement landed. Until one lands, no highlight and no transition: the
  // slide is for changing VALUE, never for arriving on screen.
  it('hides the highlight and disables its slide while unmeasured', () => {
    renderControl()
    const overlay = screen.getByTestId('seg-highlight')
    expect(overlay.style.visibility).toBe('hidden')
    expect(overlay.className).not.toContain('transition-[clip-path]')
  })

  it('clips the highlight to the active option once real geometry lands', () => {
    const original = Element.prototype.getBoundingClientRect
    const rect = (left: number, width: number): DOMRect =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 32,
        height: 32,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    Element.prototype.getBoundingClientRect = function () {
      const id = (this as Element).getAttribute?.('data-testid') ?? ''
      if (id === 'seg-highlight') return rect(0, 300)
      if (id === 'seg-a') return rect(0, 100)
      if (id === 'seg-b') return rect(100, 100)
      if (id === 'seg-c') return rect(200, 100)
      return rect(0, 0)
    }
    try {
      renderControl()
      const overlay = screen.getByTestId('seg-highlight')
      expect(overlay.style.clipPath).toContain('inset(0 100px 0 100px')
      expect(overlay.style.visibility).not.toBe('hidden')
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })

  // aria-pressed stays on the real buttons — the overlay never becomes the source of
  // truth for which option is active.
  it('still toggles through the real buttons', () => {
    const { onChange } = renderControl()
    fireEvent.click(screen.getByTestId('seg-c'))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.getByTestId('seg-b')).toHaveAttribute('aria-pressed', 'true')
  })
})
