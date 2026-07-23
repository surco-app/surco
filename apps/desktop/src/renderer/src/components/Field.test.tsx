// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Field } from './Field'

afterEach(cleanup)

// WHY these tests exist: on a big crate every keystroke that reaches the global track
// array re-runs an O(number of tracks) derived pipeline (duplicate scan, tallies,
// filter+sort), so typing lagged the more tracks were loaded. Field now buffers its
// own text and only commits to that global state when the user pauses or leaves the
// field — so the expensive walk runs once per edit, not once per keystroke.
describe('Field committing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows each keystroke immediately without committing on every one', () => {
    const onChange = vi.fn()
    render(<Field name="title" label="Title" value="" onChange={onChange} />)
    const input = screen.getByTestId('field-title') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.change(input, { target: { value: 'Ab' } })
    fireEvent.change(input, { target: { value: 'Abc' } })

    // The user sees their text land instantly — the field is responsive regardless of
    // how many tracks the pending commit would make the app walk.
    expect(input.value).toBe('Abc')
    // But the global array is not touched mid-burst: the O(n) pipeline stays idle.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits once after the user pauses', () => {
    const onChange = vi.fn()
    render(<Field name="title" label="Title" value="" onChange={onChange} />)
    const input = screen.getByTestId('field-title')

    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.change(input, { target: { value: 'Ab' } })
    vi.runAllTimers()

    // One commit for the whole burst — not one per keystroke.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('Ab')
  })

  it('commits immediately on blur so a pending edit is never lost', () => {
    const onChange = vi.fn()
    render(<Field name="title" label="Title" value="" onChange={onChange} />)
    const input = screen.getByTestId('field-title')

    fireEvent.change(input, { target: { value: 'Hola' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('Hola')
  })

  it('adopts an external value change when the field is not being edited', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Field name="title" label="Title" value="First" onChange={onChange} />,
    )
    const input = screen.getByTestId('field-title') as HTMLInputElement

    // An undo, an applied Discogs release or a landed match rewrites the value from
    // outside while the field sits untouched; the field must show the new value.
    rerender(<Field name="title" label="Title" value="Reverted" onChange={onChange} />)

    expect(input.value).toBe('Reverted')
  })

  it('keeps the in-flight edit when a match lands on the row mid-typing', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Field name="title" label="Title" value="Original" onChange={onChange} />,
    )
    const input = screen.getByTestId('field-title') as HTMLInputElement

    // User types (not yet committed); meanwhile the background auto-match sweep lands and
    // rewrites this same track's title. The user's words are newer and must win — the
    // whole point of typing during a probe is not to have it silently reverted.
    fireEvent.change(input, { target: { value: 'Hand Typed' } })
    rerender(<Field name="title" label="Title" value="Matched Title" onChange={onChange} />)

    expect(input.value).toBe('Hand Typed')
  })
})

// The form is keyboard-first, so Enter should behave like it does everywhere else the
// user types a value and moves on: commit what's typed and jump to the next field, so a
// whole release is entered without touching the mouse or waiting on the pause-debounce.
describe('Field Enter commits and advances', () => {
  it('commits the draft and moves focus to the next field on Enter', () => {
    const onChange = vi.fn()
    render(
      <div>
        <Field name="title" label="Title" value="" onChange={onChange} />
        <Field name="artist" label="Artist" value="" onChange={() => {}} />
      </div>,
    )
    const title = screen.getByTestId('field-title') as HTMLInputElement
    const artist = screen.getByTestId('field-artist')
    title.focus()

    fireEvent.change(title, { target: { value: 'Song' } })
    fireEvent.keyDown(title, { key: 'Enter' })

    // The keystroke is committed at once (no waiting on the debounce)...
    expect(onChange).toHaveBeenCalledWith('Song')
    // ...and focus has moved on, so the next value can be typed immediately.
    expect(artist).toHaveFocus()
  })

  it('commits on Enter even when it is the last field with nowhere to advance', () => {
    const onChange = vi.fn()
    render(<Field name="title" label="Title" value="" onChange={onChange} />)
    const input = screen.getByTestId('field-title')

    fireEvent.change(input, { target: { value: 'Solo' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('Solo')
  })
})

// The BPM/Key chips come from an audio probe that resolves after the form is on screen.
// Without a placeholder the detected chip popped into empty space; a loading chip holds
// its spot so the swap is seamless, and it must vanish the instant the real chip lands.
describe('Field suggestion loading chip', () => {
  it('shows a placeholder chip while a suggestion is being detected', () => {
    render(<Field name="bpm" label="BPM" value="" onChange={() => {}} suggesting />)
    expect(screen.getByTestId('suggestion-loading-bpm')).toBeInTheDocument()
  })

  it('replaces the placeholder with the real chip once the suggestion lands', () => {
    const { rerender } = render(
      <Field name="bpm" label="BPM" value="" onChange={() => {}} suggesting />,
    )
    expect(screen.getByTestId('suggestion-loading-bpm')).toBeInTheDocument()

    // The probe resolved: a real suggestion arrives and `suggesting` clears.
    rerender(<Field name="bpm" label="BPM" value="" onChange={() => {}} suggestions={['128']} />)
    expect(screen.queryByTestId('suggestion-loading-bpm')).toBeNull()
    expect(screen.getByTestId('chip-128')).toBeInTheDocument()
  })

  it('shows no placeholder when nothing is being detected', () => {
    render(<Field name="title" label="Title" value="" onChange={() => {}} />)
    expect(screen.queryByTestId('suggestion-loading-title')).toBeNull()
  })
})

// jsdom no hace layout: para ejercitar el corte medido se inyectan anchos — el contenedor
// de chips por su testid, cualquier otro elemento (chips reales y fila de medición) con un
// ancho fijo por chip.
function mockChipWidths(containerWidth: number, chipWidth: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.dataset.testid === 'field-suggestions' ? containerWidth : chipWidth
    return {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
}

const FIVE = ['Electronic', 'asia records', 'eurobeat', 'happy music', 'italo dance']

// WHY: el corte fijo en 2 chips saltaba a una segunda línea en columnas estrechas y
// desperdiciaba hueco en las anchas; ahora el corte se mide. Colapsada, la fila es UNA
// línea siempre; cuántos chips enseña depende del ancho real.
describe('Field suggestion chips layout', () => {
  afterEach(() => vi.restoreAllMocks())

  it('la fila colapsada es una sola línea sin scroll horizontal', () => {
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    const container = screen.getByTestId('field-suggestions')
    expect(container.className).toContain('flex-nowrap')
    expect(container.className).toContain('overflow-hidden')
    expect(container.className).not.toContain('overflow-x-auto')
  })

  it('corta donde el ancho manda y agrupa el resto en +N', () => {
    // chips de 80, contenedor 260: caben 2 + "+N" (80+6+80+6+80 = 252 ≤ 260)
    mockChipWidths(260, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-Electronic')).toBeInTheDocument()
    expect(screen.getByTestId('chip-asia records')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-eurobeat')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+3')
  })

  it('con más ancho enseña más chips antes del +N', () => {
    // contenedor 400: k=3 → 240+12+6+80 = 338 ≤ 400; k=4 → 424 > 400
    mockChipWidths(400, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-eurobeat')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-happy music')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
  })

  it('despliega el resto en varias líneas al pulsar +N', () => {
    mockChipWidths(260, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    fireEvent.click(screen.getByTestId('chip-more'))
    expect(screen.getByTestId('chip-happy music')).toBeInTheDocument()
    expect(screen.getByTestId('chip-italo dance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
    expect(screen.getByTestId('field-suggestions').className).toContain('flex-wrap')
  })

  it('no muestra +N cuando todos caben', () => {
    mockChipWidths(1000, 80)
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-italo dance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
  })

  it('sin medida fiable (jsdom sin mock) muestra todos y ningún +N', () => {
    render(<Field name="genre" label="Genre" value="" onChange={() => {}} suggestions={FIVE} />)
    expect(screen.getByTestId('chip-italo dance')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-more')).not.toBeInTheDocument()
  })
})
