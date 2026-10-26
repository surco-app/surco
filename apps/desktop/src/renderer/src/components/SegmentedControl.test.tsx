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

describe('SegmentedControl grouping', () => {
  // Three pressed/unpressed buttons in a row gave VoiceOver no hint they were one choice;
  // a named group says what is being chosen before the options ("Theme, group, Dark").
  it('groups its options under the given name', () => {
    render(
      <SegmentedControl
        options={['a', 'b'] as const}
        value="a"
        onChange={vi.fn()}
        testidPrefix="seg"
        labelFor={(id) => id}
        label="Theme"
      />,
    )
    expect(screen.getByRole('group', { name: 'Theme' })).toContainElement(
      screen.getByTestId('seg-b'),
    )
  })
})

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
        const m = overlayEl.style.clipPath.match(/inset\(0px ([\d.]+)px 0px ([\d.]+)px round/)
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
      const m = overlayEl.style.clipPath.match(/inset\(0px ([\d.]+)px 0px ([\d.]+)px round/)
      expect(m).not.toBeNull()
      expect(Number(m?.[1])).toBeCloseTo(1011.6484375 - 732.265625, 6)
      expect(Number(m?.[2])).toBeCloseTo(649.3984375 - 484, 6)
    } finally {
      spy.mockRestore()
      Element.prototype.getBoundingClientRect = original
    }
  })

  // In a narrow panel the four loudness presets ran past the panel edge ("Personalizado" cut
  // off). The row now wraps instead, so the raised copy must clip to the active segment's
  // row as well as its column, or it would paint every row's segment in that column.
  it('wraps onto another row when the options do not fit, and clips the highlight to the active row', () => {
    const original = Element.prototype.getBoundingClientRect
    const rect = (left: number, right: number, top: number, bottom: number): DOMRect =>
      ({
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    Element.prototype.getBoundingClientRect = function () {
      const id = (this as Element).getAttribute?.('data-testid') ?? ''
      if (id === 'seg-highlight') return rect(0, 300, 0, 70)
      if (id === 'seg-c') return rect(3, 120, 37, 67)
      return rect(0, 0.0001, 0, 0.0001)
    }
    const realGCS = window.getComputedStyle.bind(window)
    const spy = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((el, pseudo) =>
        (el as Element).getAttribute?.('data-testid') === 'seg-highlight'
          ? ({ width: '300px', height: '70px' } as CSSStyleDeclaration)
          : realGCS(el, pseudo),
      )
    try {
      renderControl('c')
      expect(screen.getByRole('group').className).toContain('flex-wrap')
      expect(screen.getByTestId('seg-highlight').className).toContain('flex-wrap')
      expect(screen.getByTestId('seg-highlight').style.clipPath).toBe(
        'inset(37px 180px 3px 3px round 6px)',
      )
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

describe('SegmentedControl in a narrow panel', () => {
  // A row that does not fit used to wrap and leave its last option alone on a second line
  // ("Benutzerdefiniert" under three presets). It lays out as an even grid of two rows
  // instead, and goes back to one row as soon as the panel is wide enough.
  function withWidths(natural: number, available: number) {
    const offset = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'seg-measure' ? natural : 0
      })
    const client = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.querySelector('[data-testid="seg-measure"]') ? available : 0
      })
    return () => {
      offset.mockRestore()
      client.mockRestore()
    }
  }
  const four = () =>
    render(
      <div>
        <SegmentedControl
          options={['a', 'b', 'c', 'd'] as const}
          value="a"
          onChange={vi.fn()}
          testidPrefix="seg"
          labelFor={(id) => id}
          label="Preset"
        />
      </div>,
    )

  it('sets its options as an even grid of two rows when one row would not fit', () => {
    const restore = withWidths(445, 353)
    four()
    const group = screen.getByRole('group', { name: 'Preset' })
    expect(group).toHaveAttribute('data-layout', 'grid')
    expect(group.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    restore()
  })

  it('keeps one row while it fits', () => {
    const restore = withWidths(300, 353)
    four()
    expect(screen.getByRole('group', { name: 'Preset' })).toHaveAttribute('data-layout', 'row')
    restore()
  })
})
