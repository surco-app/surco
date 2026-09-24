// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { CustomField } from '../../../shared/types'
import { FIELD_DEFS } from '../lib/fields'
import { FieldsEditor } from './FieldsEditor'

afterEach(cleanup)

function setup(
  over: {
    visibleFields?: string[]
    requiredFields?: string[]
    importFields?: string[]
    customFields?: CustomField[]
    separators?: { genre: string; grouping: string }
  } = {},
) {
  const onChangeVisible = vi.fn()
  const onChangeRequired = vi.fn()
  const onChangeImport = vi.fn()
  const onChangeCustom = vi.fn()
  const onChangeSeparator = vi.fn()
  render(
    <FieldsEditor
      visibleFields={over.visibleFields ?? ['title', 'artist', 'album']}
      requiredFields={over.requiredFields ?? ['title']}
      importFields={over.importFields ?? ['title']}
      customFields={over.customFields ?? []}
      onChangeVisible={onChangeVisible}
      onChangeRequired={onChangeRequired}
      onChangeImport={onChangeImport}
      onChangeCustom={onChangeCustom}
      separators={over.separators}
      onChangeSeparator={onChangeSeparator}
    />,
  )
  return { onChangeVisible, onChangeRequired, onChangeImport, onChangeCustom, onChangeSeparator }
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

  // The {key} token is what templates and tag tools call the field, but it lived only in
  // a hover tooltip on plain text that neither the keyboard nor a screen reader reaches.
  it('gives the internal field name to assistive tech without a hover', () => {
    setup()
    const row = screen.getByTestId('field-row-artist')
    expect(within(row).getByText('Internal name {artist}')).toBeInTheDocument()
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
    fireEvent.click(within(row).getByLabelText('Move Title down'))
    expect(onChangeVisible).toHaveBeenCalledWith(['artist', 'title', 'album'])
  })

  // Moving a field to the top or bottom disables the arrow that moved it, and a disabled
  // button drops keyboard focus to the body: the user lost their place in a long list.
  // Focus goes to the other arrow of the same row, which is still usable.
  it('keeps focus in the row when an arrow moves the field to either end', () => {
    const props = {
      requiredFields: [],
      importFields: [],
      customFields: [],
      onChangeVisible: vi.fn(),
      onChangeRequired: vi.fn(),
      onChangeImport: vi.fn(),
      onChangeCustom: vi.fn(),
    }
    const { rerender } = render(
      <FieldsEditor visibleFields={['title', 'artist', 'album']} {...props} />,
    )
    const up = within(screen.getByTestId('field-row-artist')).getByLabelText('Move Artist up')
    up.focus()
    fireEvent.click(up)
    rerender(<FieldsEditor visibleFields={['artist', 'title', 'album']} {...props} />)
    expect(
      within(screen.getByTestId('field-row-artist')).getByLabelText('Move Artist down'),
    ).toHaveFocus()

    const down = within(screen.getByTestId('field-row-title')).getByLabelText('Move Title down')
    down.focus()
    fireEvent.click(down)
    rerender(<FieldsEditor visibleFields={['artist', 'album', 'title']} {...props} />)
    expect(
      within(screen.getByTestId('field-row-title')).getByLabelText('Move Title up'),
    ).toHaveFocus()
  })

  // Thirty rows of identical "Auto, Required, Move up, Move down, Hide" buttons are
  // indistinguishable in a screen reader's list of controls, and out of the row's visual
  // context "Hide" doesn't say what it hides. Each name carries its field, as Delete does.
  it('names every row control after the field it acts on', () => {
    setup({ visibleFields: ['title', 'artist', 'album'], importFields: [] })
    const row = within(screen.getByTestId('field-row-artist'))
    expect(row.getByRole('button', { name: 'Fill Artist automatically' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Artist required' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Move Artist up' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Move Artist down' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Hide Artist' })).toBeInTheDocument()
  })

  it('names the Show button of a hidden row after its field', () => {
    setup({ visibleFields: ['title'] })
    const row = within(screen.getByTestId('hidden-field-artist'))
    expect(row.getByRole('button', { name: 'Show Artist' })).toBeInTheDocument()
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

  // What auto-organize does was only in its tooltip, so a screen reader met a bare
  // "Auto-organize" button; the same sentence is its description.
  it('describes what auto-organize does to assistive tech', () => {
    setup()
    expect(screen.getByTestId('auto-organize-fields')).toHaveAccessibleDescription(
      'Reorder shown fields by group',
    )
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

  // The in-button "Organized" flip is only seen: the button keeps focus and a screen
  // reader doesn't re-read its label, so the reorder looked like it did nothing. A live
  // status region, present from the start so it is listened to, says it out loud.
  it('announces the reorder through a status region', () => {
    setup({ visibleFields: ['bpm', 'title'], requiredFields: [] })
    const status = screen.getByTestId('auto-organize-status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toBeEmptyDOMElement()
    fireEvent.click(screen.getByTestId('auto-organize-fields'))
    expect(status).toHaveTextContent('Organized')
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

// The user's own fields live in the same list as Surco's: shown or hidden, under the name
// the user gave them, added from a row at the bottom with a key that names them in
// filename patterns and, upper-cased, in the file.
describe('custom fields', () => {
  const vinyl = { key: 'vinylCondition', label: 'Estado del vinilo' }

  it('lists a shown custom field under its own name, with its key as the token', () => {
    setup({ visibleFields: ['title', 'vinylCondition'], customFields: [vinyl] })
    const row = screen.getByTestId('field-row-vinylCondition')
    fireEvent.focusIn(within(row).getByText('Estado del vinilo'))
    expect(screen.getByText('{vinylCondition}')).toBeInTheDocument()
  })

  // The {key} hint belongs to the name: reaching the Delete button beside it must not
  // pop the token up over the button the user is about to press.
  it('keeps the key tooltip off the delete button', () => {
    setup({ visibleFields: ['title', 'vinylCondition'], customFields: [vinyl] })
    fireEvent.focusIn(screen.getByTestId('field-delete-vinylCondition'))
    expect(screen.queryByText('{vinylCondition}')).toBeNull()
  })

  it('lists a hidden custom field among the hidden ones', () => {
    setup({ visibleFields: ['title'], customFields: [vinyl] })
    expect(screen.getByTestId('hidden-field-vinylCondition')).toHaveTextContent('Estado del vinilo')
  })

  it('adds a field with the key it proposes from the name, shown at once', () => {
    const { onChangeCustom, onChangeVisible } = setup({ visibleFields: ['title'] })
    fireEvent.change(screen.getByTestId('custom-field-name'), {
      target: { value: 'Estado del vinilo' },
    })
    expect(screen.getByTestId('custom-field-key')).toHaveValue('estadoDelVinilo')
    fireEvent.click(screen.getByTestId('custom-field-add'))
    expect(onChangeCustom).toHaveBeenCalledWith([
      { key: 'estadoDelVinilo', label: 'Estado del vinilo' },
    ])
    expect(onChangeVisible).toHaveBeenCalledWith(['title', 'estadoDelVinilo'])
  })

  // The explanation of the key is read once, not repeated under every name typed: it
  // sits behind a visible (i) on the key label, and the line below shows only errors.
  it('explains the key once in a note and keeps the line below for errors', () => {
    setup()
    fireEvent.change(screen.getByTestId('custom-field-name'), {
      target: { value: 'Estado del vinilo' },
    })
    expect(screen.queryByTestId('custom-field-hint')).toBeNull()
    expect(screen.getByTestId('custom-field-key-note')).toHaveAttribute('role', 'note')
  })

  it('refuses a key another field already uses and says so', () => {
    const { onChangeCustom } = setup()
    fireEvent.change(screen.getByTestId('custom-field-name'), { target: { value: 'Estilo' } })
    fireEvent.change(screen.getByTestId('custom-field-key'), { target: { value: 'style' } })
    expect(screen.getByTestId('custom-field-add')).toBeDisabled()
    expect(screen.getByTestId('custom-field-hint')).toHaveTextContent(/already/i)
    expect(onChangeCustom).not.toHaveBeenCalled()
  })

  // The red border and aria-invalid said "wrong" without saying why: the reason sat in
  // a paragraph below that nothing tied to the field, and appeared silently. It has to be
  // the field's description and be announced the moment it shows up.
  it('ties the key error to the key field and announces it', () => {
    setup()
    fireEvent.change(screen.getByTestId('custom-field-name'), { target: { value: 'Estilo' } })
    fireEvent.change(screen.getByTestId('custom-field-key'), { target: { value: 'style' } })
    const hint = screen.getByTestId('custom-field-hint')
    expect(hint).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('custom-field-key')).toHaveAccessibleDescription(hint.textContent)
  })

  it('deletes a custom field from the settings, the shown and the required lists', () => {
    const { onChangeCustom, onChangeVisible, onChangeRequired } = setup({
      visibleFields: ['title', 'vinylCondition'],
      requiredFields: ['title', 'vinylCondition'],
      customFields: [vinyl],
    })
    fireEvent.click(screen.getByTestId('field-delete-vinylCondition'))
    expect(onChangeCustom).toHaveBeenCalledWith([])
    expect(onChangeVisible).toHaveBeenCalledWith(['title'])
    expect(onChangeRequired).toHaveBeenCalledWith(['title'])
  })
})

// Plex splits a genre only on ";" and reads "Pop, Indie Pop" as one genre, while a Grouping
// read by Apple Music smart playlists is fine with commas: each field picks its own.
describe('FieldsEditor tag separators', () => {
  const separators = { genre: ', ', grouping: ', ' }

  it('offers a separator on the Genre and Grouping rows only', () => {
    setup({ visibleFields: ['title', 'genre', 'grouping'], separators })
    expect(screen.getByTestId('field-separator-genre')).toBeInTheDocument()
    expect(screen.getByTestId('field-separator-grouping')).toBeInTheDocument()
    expect(screen.queryByTestId('field-separator-title')).not.toBeInTheDocument()
  })

  // The row stays one line: the separator is a small menu beside the name, not a second
  // line of buttons under it.
  it('sits beside the field name on the row line', () => {
    setup({ visibleFields: ['genre'], separators })
    const row = screen.getByTestId('field-row-genre')
    expect(within(row).getByText('Genre').parentElement).toContainElement(
      screen.getByTestId('field-separator-genre'),
    )
  })

  it('names the current separator and switches the field to another one', () => {
    const { onChangeSeparator } = setup({ visibleFields: ['genre'], separators })
    expect(screen.getByTestId('field-separator-genre')).toHaveTextContent(',')
    fireEvent.click(screen.getByTestId('field-separator-genre'))
    expect(screen.getByTestId('field-separator-genre-option-semicolon')).toHaveTextContent(
      'Pop; House',
    )
    fireEvent.click(screen.getByTestId('field-separator-genre-option-semicolon'))
    expect(onChangeSeparator).toHaveBeenCalledWith('genre', '; ')
  })

  it('takes a separator of the user own from Other', () => {
    const { onChangeSeparator } = setup({ visibleFields: ['grouping'], separators })
    expect(screen.queryByTestId('field-separator-grouping-input')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('field-separator-grouping'))
    fireEvent.click(screen.getByTestId('field-separator-grouping-option-custom'))
    fireEvent.change(screen.getByTestId('field-separator-grouping-input'), {
      target: { value: ' | ' },
    })
    expect(onChangeSeparator).toHaveBeenCalledWith('grouping', ' | ')
  })

  it('shows a separator of the user own under Other with its text', () => {
    setup({ visibleFields: ['grouping'], separators: { genre: ', ', grouping: ' | ' } })
    expect(screen.getByTestId('field-separator-grouping')).toHaveTextContent('Other')
    expect(screen.getByTestId('field-separator-grouping-input')).toHaveValue(' | ')
  })

  it('leaves the separators out where the caller does not manage them', () => {
    render(
      <FieldsEditor
        visibleFields={['genre']}
        requiredFields={[]}
        importFields={[]}
        customFields={[]}
        onChangeVisible={vi.fn()}
        onChangeRequired={vi.fn()}
        onChangeImport={vi.fn()}
        onChangeCustom={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('field-separator-genre')).not.toBeInTheDocument()
  })
})
