// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
