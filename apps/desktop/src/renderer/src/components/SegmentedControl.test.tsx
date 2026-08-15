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

  // Two regressions in one measurement. Rects alone: the settings modal pops in at
  // scale(0.98), viewport rects shrink with it while clip-path applies in unscaled
  // local space, and the ~2% skew stuck for good (ResizeObserver ignores transforms)
  // — a sliver of the neighbouring copy stayed visible. Integer offsetLeft/offsetWidth
  // alone: real layout is fractional, and the rounding cut the raised segment's right
  // ring flat. So: fractional rect deltas, rescaled into local space by the layout
  // width — exact under any uniform ancestor scale.
  it('rescales fractional rect measurements into unscaled local space', () => {
    const original = Element.prototype.getBoundingClientRect
    // The overlay laid out 300px wide but currently painted at scale 0.98 from x=1000;
    // button "c" spans [201, 297] in local space.
    const scaled = (localLeft: number, localRight: number): DOMRect =>
      ({
        left: 1000 + localLeft * 0.98,
        right: 1000 + localRight * 0.98,
        width: (localRight - localLeft) * 0.98,
        top: 0,
        bottom: 31.36,
        height: 31.36,
        x: 1000 + localLeft * 0.98,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    Element.prototype.getBoundingClientRect = function () {
      const id = (this as Element).getAttribute?.('data-testid') ?? ''
      if (id === 'seg-highlight') return scaled(0, 300)
      if (id === 'seg-a') return scaled(3, 99)
      if (id === 'seg-b') return scaled(101, 199)
      if (id === 'seg-c') return scaled(201, 297)
      return scaled(0, 0)
    }
    try {
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
      const overlayEl = screen.getByTestId('seg-highlight')
      // The true layout width comes from computed style: fractional, unaffected by
      // transforms. offsetWidth would round 300 → fine here, but 527.65 → 528 in the
      // real app, and that lie skewed the factor and shaved the ring (see below).
      const realGCS = window.getComputedStyle.bind(window)
      const spy = vi
        .spyOn(window, 'getComputedStyle')
        .mockImplementation((el, pseudo) =>
          el === overlayEl ? ({ width: '300px' } as CSSStyleDeclaration) : realGCS(el, pseudo),
        )
      try {
        rerender(control('c'))
        const m = overlayEl.style.clipPath.match(/inset\(0 ([\d.]+)px 0 ([\d.]+)px round/)
        expect(m).not.toBeNull()
        expect(Number(m?.[1])).toBeCloseTo(3, 1)
        expect(Number(m?.[2])).toBeCloseTo(201, 1)
        expect(overlayEl.style.visibility).not.toBe('hidden')
      } finally {
        spy.mockRestore()
      }
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })

  // Reported as "still minimally cut": with NO transform in play, the factor must be
  // exactly 1 or the boundary creeps into the raised segment and shaves its ring's
  // antialiasing. offsetWidth rounds the true layout width (527.65 → 528) and that
  // 0.07% lie moved the right edge ~0.2px inward. The fractional computed-style width
  // keeps the clip byte-identical to the rect deltas.
  it('clips exactly on the button bounds when nothing is transformed', () => {
    const original = Element.prototype.getBoundingClientRect
    const rect = (left: number, right: number): DOMRect =>
      ({
        left,
        right,
        width: right - left,
        top: 0,
        bottom: 32,
        height: 32,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    Element.prototype.getBoundingClientRect = function () {
      const id = (this as Element).getAttribute?.('data-testid') ?? ''
      if (id === 'seg-highlight') return rect(484, 1011.6484375)
      if (id === 'seg-b') return rect(649.3984375, 732.265625)
      return rect(0, 0.0001)
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
    const { rerender } = render(control('a'))
    const overlayEl = screen.getByTestId('seg-highlight')
    const realGCS = window.getComputedStyle.bind(window)
    const spy = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((el, pseudo) =>
        el === overlayEl
          ? ({ width: '527.6484375px' } as CSSStyleDeclaration)
          : realGCS(el, pseudo),
      )
    try {
      rerender(control('b'))
      const m = overlayEl.style.clipPath.match(/inset\(0 ([\d.]+)px 0 ([\d.]+)px round/)
      expect(m).not.toBeNull()
      expect(Number(m?.[1])).toBeCloseTo(1011.6484375 - 732.265625, 6)
      expect(Number(m?.[2])).toBeCloseTo(649.3984375 - 484, 6)
    } finally {
      spy.mockRestore()
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
