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

  // Regression: measuring with getBoundingClientRect skewed the clip by ~2% whenever
  // the control mounted inside the settings modal's pop-in — viewport rects shrink
  // with the scale(0.98) entrance while clip-path applies in unscaled local space —
  // and the skew stuck for good, since ResizeObserver never fires for transforms. A
  // sliver of the neighbouring copy stayed visible. offsetLeft/offsetWidth are layout
  // values, immune to any ancestor transform.
  it('clips the highlight from layout geometry, immune to entrance transforms', () => {
    const define = (el: Element, left: number, width: number): void => {
      Object.defineProperty(el, 'offsetLeft', { value: left, configurable: true })
      Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true })
    }
    const onChange = vi.fn()
    const control = (value: string): React.JSX.Element => (
      <SegmentedControl
        options={['a', 'b', 'c'] as const}
        value={value}
        onChange={onChange}
        testidPrefix="seg"
        labelFor={(id) => id.toUpperCase()}
      />
    )
    const { rerender } = render(control('b'))
    define(screen.getByTestId('seg-highlight'), 0, 300)
    define(screen.getByTestId('seg-a'), 3, 96)
    define(screen.getByTestId('seg-b'), 101, 98)
    define(screen.getByTestId('seg-c'), 201, 96)
    rerender(control('c'))
    const overlay = screen.getByTestId('seg-highlight')
    expect(overlay.style.clipPath).toBe('inset(0 3px 0 201px round 6px)')
    expect(overlay.style.visibility).not.toBe('hidden')
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
