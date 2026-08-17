// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { FIELD_DEFS } from '../lib/fields'
import { FieldsEditor } from './FieldsEditor'

afterEach(cleanup)

function setup(
  over: { visibleFields?: string[]; requiredFields?: string[]; importFields?: string[] } = {},
) {
  const onChangeVisible = vi.fn()
  const onChangeRequired = vi.fn()
  const onChangeImport = vi.fn()
  render(
    <FieldsEditor
      visibleFields={over.visibleFields ?? ['title', 'artist', 'album']}
      requiredFields={over.requiredFields ?? ['title']}
      importFields={over.importFields ?? ['title']}
      onChangeVisible={onChangeVisible}
      onChangeRequired={onChangeRequired}
      onChangeImport={onChangeImport}
    />,
  )
  return { onChangeVisible, onChangeRequired, onChangeImport }
}

describe('FieldsEditor', () => {
  // The localized label ("Título") hides the internal name templates and tag tools
  // use ({trackNumber}, Mp3tag's field mapping); the hover tooltip bridges the two —
  // the app's styled Tooltip (instant on hover), not the slow native title.
  it('exposes the internal field name as a hover tooltip', () => {
    setup()
    const row = screen.getByTestId('field-row-title')
    // focusin reveals the tooltip instantly (the hover path sits behind a 400ms timer)
    fireEvent.focusIn(within(row).getByText('Title'))
    expect(screen.getByText('{title}')).toBeInTheDocument()
  })

  // Arrow buttons move one step at a time; with 21 fields, dragging a row straight
  // to its place is the natural gesture. The drag starts from the grip handle so
  // the row's buttons stay plain clicks.
  it('reorders by dragging a row onto another', () => {
    const { onChangeVisible } = setup()
    const dt = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.mouseDown(
      within(screen.getByTestId('field-row-title')).getByTestId('field-grip-title'),
    )
    fireEvent.dragStart(screen.getByTestId('field-row-title'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('field-row-album'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('field-row-album'), { dataTransfer: dt })
    expect(onChangeVisible).toHaveBeenCalledWith(['artist', 'album', 'title'])
  })

  it('toggles a field required', () => {
    const { onChangeRequired } = setup()
    fireEvent.click(screen.getByTestId('field-required-artist'))
    expect(onChangeRequired).toHaveBeenCalledWith(['title', 'artist'])
  })

  it('un-requires a field that was required', () => {
    const { onChangeRequired } = setup()
    fireEvent.click(screen.getByTestId('field-required-title'))
    expect(onChangeRequired).toHaveBeenCalledWith([])
  })

  // Hiding a field must also drop it from required: a hidden field can't be filled, so
  // requiring it would block every conversion with no field to satisfy it.
  it('hiding a field removes it from both visible and required', () => {
    const { onChangeVisible, onChangeRequired } = setup()
    const row = screen.getByTestId('field-row-title')
    fireEvent.click(within(row).getByText('Hide'))
    expect(onChangeVisible).toHaveBeenCalledWith(['artist', 'album'])
    expect(onChangeRequired).toHaveBeenCalledWith([])
  })

  it('showing a hidden field appends it to the visible list', () => {
    const { onChangeVisible } = setup({ visibleFields: ['title'], requiredFields: [] })
    // 'artist' is not visible, so it appears in the hidden list with a Show button.
    const hidden = screen.getByText('Artist').closest('div') as HTMLElement
    fireEvent.click(within(hidden).getByText('Show'))
    expect(onChangeVisible).toHaveBeenCalledWith(['title', 'artist'])
  })

  it('reorders a visible field down', () => {
    const { onChangeVisible } = setup()
    const row = screen.getByTestId('field-row-title')
    fireEvent.click(within(row).getByLabelText('Move down'))
    expect(onChangeVisible).toHaveBeenCalledWith(['artist', 'title', 'album'])
  })

  // The auto-organize button reorders the shown fields into group order in one click,
  // so a user who enabled fields ad hoc gets a tidy identity → catalog → dj → order
  // layout without dragging each one. It only reorders — nothing is shown or hidden.
  it('auto-organizes the visible fields into group order', () => {
    const { onChangeVisible, onChangeRequired } = setup({
      visibleFields: ['bpm', 'title', 'catalogNumber', 'artist'],
      requiredFields: ['title'],
    })
    fireEvent.click(screen.getByTestId('auto-organize-fields'))
    expect(onChangeVisible).toHaveBeenCalledWith(['title', 'artist', 'catalogNumber', 'bpm'])
    // Reorder only: it must not touch which fields are required.
    expect(onChangeRequired).not.toHaveBeenCalled()
  })

  // The hint must come from the app's styled Tooltip, not the OS-grey native title
  // box that clashes with the theme.
  it('hints auto-organize with the styled tooltip, not a native title', () => {
    setup()
    const btn = screen.getByTestId('auto-organize-fields')
    expect(btn).not.toHaveAttribute('title')
    fireEvent.focusIn(btn)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reorder shown fields by group')
  })

  // Reordering a list that scrolls (and may already be tidy) gives no visible sign it ran,
  // so the button confirms in place: it flips to a done label, then reverts on its own.
  it('confirms in the button after auto-organizing, then reverts', () => {
    vi.useFakeTimers()
    try {
      setup({ visibleFields: ['bpm', 'title'], requiredFields: [] })
      const btn = screen.getByTestId('auto-organize-fields')
      expect(btn).toHaveTextContent('Auto-organize')
      fireEvent.click(btn)
      expect(btn).toHaveTextContent('Organized')
      act(() => vi.advanceTimersByTime(1600))
      expect(btn).toHaveTextContent('Auto-organize')
    } finally {
      vi.useRealTimers()
    }
  })

  // Unlike the visible list — whose order the user curates because it IS the
  // editor's order — the hidden list has no meaningful order of its own, so it
  // sorts alphabetically by the translated label to be scannable.
  it('lists hidden fields alphabetically by label', () => {
    const hiddenKeys = ['trackNumber', 'comment', 'discNumber', 'bpm', 'key', 'remixArtist']
    setup({
      visibleFields: FIELD_DEFS.map((d) => d.key).filter((k) => !hiddenKeys.includes(k)),
      requiredFields: [],
    })
    const rows = screen.getAllByTestId(/^hidden-field-/)
    // English labels: BPM, Comment, Disc No., Key, Remix artist, Track No.
    expect(rows.map((el) => el.getAttribute('data-testid'))).toEqual([
      'hidden-field-bpm',
      'hidden-field-comment',
      'hidden-field-discNumber',
      'hidden-field-key',
      'hidden-field-remixArtist',
      'hidden-field-trackNumber',
    ])
  })
})

// Whether a match fills a field is a property OF the field, like "required" — not a
// Discogs setting. It used to live in Settings → Search under a Discogs heading, which
// both buried it and implied it only applied to Discogs; it governs every provider.
describe('auto-fill toggle', () => {
  it('turns auto-fill on for a field that is off', () => {
    const { onChangeImport } = setup({ importFields: ['title'] })
    fireEvent.click(screen.getByTestId('field-auto-artist'))
    expect(onChangeImport).toHaveBeenCalledWith(['title', 'artist'])
  })

  it('turns auto-fill off for a field that is on', () => {
    const { onChangeImport } = setup({ importFields: ['title', 'artist'] })
    fireEvent.click(screen.getByTestId('field-auto-title'))
    expect(onChangeImport).toHaveBeenCalledWith(['artist'])
  })

  // A real checkbox rather than a button styled as one: it is the control the rest of the
  // app uses for a boolean (thirteen settings and counting), so it inherits the system's
  // own tick, focus ring and keyboard handling instead of re-implementing them — the
  // hand-rolled version needed aria-pressed and aria-label bolted on to pass for one.
  // The state reads as an icon rather than a tick box, matching the eye that marks a
  // section visible. aria-pressed is what carries it to a screen reader, and it is also
  // what the two icons are chosen from — so it must track the real state, not the styling.
  it('reports its state as a pressed toggle', () => {
    setup({ importFields: ['title'] })
    expect(screen.getByTestId('field-auto-title')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('field-auto-artist')).toHaveAttribute('aria-pressed', 'false')
  })

  // Colour alone can't carry the difference: the two states have to be different shapes, or
  // a column of them says nothing at a glance (and nothing at all to anyone who can't tell
  // the two colours apart). The on icon is a filled check, the off one a dashed outline.
  it('draws a different icon for each state', () => {
    setup({ importFields: ['title'] })
    const on = screen.getByTestId('field-auto-title').querySelector('svg')?.innerHTML
    const off = screen.getByTestId('field-auto-artist').querySelector('svg')?.innerHTML
    expect(on).toBeTruthy()
    expect(off).toBeTruthy()
    expect(on).not.toEqual(off)
  })

  // The column heading says "Auto", so the control repeats nothing — but a screen reader
  // reads controls out of context, so the accessible name still has to name it.
  it('still names the toggle for a screen reader', () => {
    setup({ importFields: ['title'] })
    expect(screen.getByTestId('field-auto-title')).toHaveAccessibleName(/auto/i)
  })

  // No provider supplies BPM, key, mood or a personal comment — they are the DJ's own
  // work. A toggle there would promise an import that can never happen, so the button is
  // absent rather than present-but-dead.
  it('offers no toggle on a field no provider can fill', () => {
    setup({ visibleFields: ['title', 'bpm', 'comment'], requiredFields: [] })
    expect(screen.getByTestId('field-auto-title')).toBeInTheDocument()
    expect(screen.queryByTestId('field-auto-bpm')).not.toBeInTheDocument()
    expect(screen.queryByTestId('field-auto-comment')).not.toBeInTheDocument()
  })

  // A hidden field still gets written to the file — the user just doesn't see it in the
  // form. Someone who hides Country but wants it tagged has to be able to say so without
  // showing it first, so the hidden list carries the toggle too.
  it('offers the toggle on hidden fields as well', () => {
    setup({ visibleFields: ['title'], requiredFields: [], importFields: ['country'] })
    const row = screen.getByTestId('hidden-field-country')
    expect(within(row).getByTestId('field-auto-country')).toHaveAttribute('aria-pressed', 'true')
  })

  // Both lists sit under one set of column headings, so a hidden row has to resolve its
  // Auto mark to the same track as a visible one. It used to run on a three-column grid of
  // its own, which put its tick under the *Required* column — reading as if hidden fields
  // were required. Sharing the row grid is what keeps the two lists on one vertical line.
  it('lays hidden rows out on the same grid as visible ones', () => {
    setup({ visibleFields: ['title'], requiredFields: [], importFields: ['country'] })
    const visible = screen.getByTestId('field-row-title').className
    const hidden = screen.getByTestId('hidden-field-country').className
    const cols = (c: string) => c.match(/grid-cols-\[[^\]]+\]/)?.[0]
    expect(cols(hidden)).toBe(cols(visible))
  })

  // The two toggles repeat identically down every row, which makes them columns — so they
  // are headed once rather than explained on each button. A heading is read on arrival and
  // ignored from then on, where a tooltip on all sixteen kept covering the rows below long
  // after the user had learnt what it meant.
  it('heads the toggle columns', () => {
    setup()
    const head = screen.getByTestId('fields-columns')
    expect(head).toHaveTextContent(/auto/i)
    expect(head).toHaveTextContent(/required/i)
  })

  it('raises no tooltip from the toggle itself', () => {
    setup()
    fireEvent.focusIn(screen.getByTestId('field-auto-title'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  // "Auto" names the column but doesn't say what it does, so the meaning has to live
  // somewhere. It hangs off the heading — one place, asked for once — rather than off all
  // thirty-two buttons, where the same paragraph kept covering the rows underneath.
  it('explains Auto from its column heading', () => {
    setup()
    fireEvent.focusIn(screen.getByTestId('fields-column-auto'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/fill/i)
  })

  // Required has the same problem: the label alone doesn't say that an empty one blocks
  // converting, which is the whole point of marking a field required.
  it('explains Required from its column heading', () => {
    setup()
    fireEvent.focusIn(screen.getByTestId('fields-column-required'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/convert/i)
  })

  // A hoverable heading with nothing to show for it is help you only find by accident.
  // The (i) is what makes it discoverable, and the note carries the same sentence for a
  // screen reader, which never sees the hover tooltip at all.
  it('marks each heading as carrying help, readable without a pointer', () => {
    setup()
    const notes = within(screen.getByTestId('fields-columns')).getAllByRole('note')
    expect(notes).toHaveLength(2)
    expect(notes[0]).toHaveTextContent(/fill/i)
    expect(notes[1]).toHaveTextContent(/convert/i)
  })
})
