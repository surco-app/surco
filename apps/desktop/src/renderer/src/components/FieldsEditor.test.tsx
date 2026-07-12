// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { FIELD_DEFS } from '../lib/fields'
import { FieldsEditor } from './FieldsEditor'

afterEach(cleanup)

function setup(over: { visibleFields?: string[]; requiredFields?: string[] } = {}) {
  const onChangeVisible = vi.fn()
  const onChangeRequired = vi.fn()
  render(
    <FieldsEditor
      visibleFields={over.visibleFields ?? ['title', 'artist', 'album']}
      requiredFields={over.requiredFields ?? ['title']}
      onChangeVisible={onChangeVisible}
      onChangeRequired={onChangeRequired}
    />,
  )
  return { onChangeVisible, onChangeRequired }
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
    fireEvent.mouseDown(within(screen.getByTestId('field-row-title')).getByTestId('field-grip-title'))
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
