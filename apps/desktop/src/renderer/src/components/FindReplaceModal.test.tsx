// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { FindReplaceModal } from './FindReplaceModal'

afterEach(cleanup)

const emptyMeta: TrackMetadata = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function track(id: string, meta: Partial<TrackMetadata>): TrackItem {
  return {
    id,
    inputPath: `/m/${id}`,
    fileName: `${id}.flac`,
    listLabel: meta.title ?? `${id}.flac`,
    query: '',
    status: 'idle',
    meta: { ...emptyMeta, ...meta },
  }
}

function renderModal(tracks: TrackItem[]) {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<FindReplaceModal tracks={tracks} onApply={onApply} onClose={onClose} />)
  return { onApply, onClose }
}

const type = (testid: string, value: string) =>
  fireEvent.change(screen.getByTestId(testid), { target: { value } })

describe('FindReplaceModal a11y', () => {
  it('exposes an accessible name on the dialog', () => {
    renderModal([track('1', { title: 'x' })])
    expect(screen.getByRole('dialog')).toHaveAccessibleName()
  })

  // Enter in the find/replace fields submits the form rather than doing nothing.
  it('applies the replacement when the form is submitted (Enter)', () => {
    const { onApply, onClose } = renderModal([track('a', { title: 'Snap (Original Mix)' })])
    type('find-replace-find', 'Original Mix')
    type('find-replace-replace', 'Radio Edit')
    fireEvent.submit(screen.getByTestId('find-replace-find').closest('form') as HTMLFormElement)
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { title: 'Snap (Radio Edit)' } }])
    expect(onClose).not.toHaveBeenCalled()
  })
})

// Cleaning a messy rip means several passes in a row — strip "1.", then "2.", then "3.".
// Closing the panel on every apply forced a reopen between each one, so the panel now stays
// up and resets itself for the next pattern.
describe('FindReplaceModal chained replacements', () => {
  it('clears both fields after applying so the next pattern can be typed straight away', () => {
    renderModal([track('a', { title: '1. Snap' })])
    type('find-replace-find', '1. ')
    type('find-replace-replace', '')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(screen.getByTestId('find-replace-find')).toHaveValue('')
    expect(screen.getByTestId('find-replace-replace')).toHaveValue('')
  })

  it('returns focus to the find field after applying', () => {
    renderModal([track('a', { title: '1. Snap' })])
    type('find-replace-find', '1. ')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(screen.getByTestId('find-replace-find')).toHaveFocus()
  })

  it('keeps the panel open across repeated applies', () => {
    const { onApply, onClose } = renderModal([track('a', { title: '1. Snap 2. Crackle' })])
    type('find-replace-find', '1. ')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    type('find-replace-find', '2. ')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
  })

  // Once a replacement has landed, "Cancel" would be a lie — there is nothing left to cancel.
  it('relabels the dismiss button from Cancel to Close after the first apply', () => {
    renderModal([track('a', { title: '1. Snap' })])
    expect(screen.getByTestId('find-replace-cancel')).toHaveTextContent('Cancel')
    type('find-replace-find', '1. ')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(screen.getByTestId('find-replace-cancel')).toHaveTextContent('Close')
  })
})

describe('FindReplaceModal', () => {
  it('applies a plain replacement to the matching field of every track', () => {
    const { onApply, onClose } = renderModal([
      track('a', { title: 'Snap (Original Mix)' }),
      track('b', { title: 'Get Wicked (Original Mix)' }),
      track('c', { title: 'No mix here' }),
    ])
    type('find-replace-find', 'Original Mix')
    type('find-replace-replace', 'Radio Edit')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledWith([
      { id: 'a', meta: { title: 'Snap (Radio Edit)' } },
      { id: 'b', meta: { title: 'Get Wicked (Radio Edit)' } },
    ])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('supports regex with $1 capture groups', () => {
    const { onApply } = renderModal([track('a', { title: 'kumara - snap' })])
    fireEvent.click(screen.getByTestId('find-replace-regex'))
    type('find-replace-find', '(.+) - (.+)')
    type('find-replace-replace', '$2 ($1)')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { title: 'snap (kumara)' } }])
  })

  // The delimiter slashes are part of the field's chrome in regex mode (so the user writes
  // the pattern alone and never wonders whether to type /.../), and gone in plain mode —
  // they aren't part of the value, so the pattern still matches the bare text.
  it('frames the find field with regex delimiter slashes only in regex mode', () => {
    renderModal([track('a', { title: 'anything' })])
    expect(screen.queryByTestId('find-replace-regex-slashes')).toBeNull()
    fireEvent.click(screen.getByTestId('find-replace-regex'))
    expect(screen.getByTestId('find-replace-regex-slashes')).toBeInTheDocument()
  })

  it('matches the bare pattern in regex mode, with the slashes only visual', () => {
    const { onApply } = renderModal([track('a', { title: 'Shake it' })])
    fireEvent.click(screen.getByTestId('find-replace-regex'))
    type('find-replace-find', 'Shake')
    type('find-replace-replace', 'Move')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { title: 'Move it' } }])
  })

  // A typo in the pattern must not let the user fire a no-op (or a throw); the button stays
  // off and the field is flagged until the regex compiles.
  it('disables apply and flags an invalid regex', () => {
    renderModal([track('a', { title: 'anything' })])
    fireEvent.click(screen.getByTestId('find-replace-regex'))
    type('find-replace-find', '(')
    expect(screen.getByTestId('find-replace-apply')).toBeDisabled()
    expect(screen.getByTestId('find-replace-find')).toHaveAttribute('aria-invalid')
  })

  it('previews the change count before applying', () => {
    renderModal([track('a', { title: 'Original Mix' }), track('b', { album: 'Original Mix' })])
    type('find-replace-find', 'Original Mix')
    type('find-replace-replace', 'x')
    expect(screen.getByTestId('find-replace-preview')).toHaveTextContent('2')
  })

  // Case-insensitive by default, so a find for "mix" cleans up "Mix", "MIX" and "mix" alike —
  // the common rip-tidying case where casing is inconsistent.
  it('matches regardless of case by default', () => {
    const { onApply } = renderModal([track('a', { title: 'snap (ORIGINAL mix)' })])
    type('find-replace-find', 'original Mix')
    type('find-replace-replace', 'Radio Edit')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { title: 'snap (Radio Edit)' } }])
  })

  // The case-sensitive toggle is for the times casing matters — fixing "dj" to "DJ" without
  // also rewriting an already-correct "DJ" or an unrelated "Dj". With it on, only the exact
  // casing matches.
  it('matches only the exact casing when case-sensitive is on', () => {
    const { onApply } = renderModal([track('a', { artist: 'dj rush meets DJ Hell' })])
    fireEvent.click(screen.getByTestId('find-replace-case'))
    type('find-replace-find', 'dj')
    type('find-replace-replace', 'DJ')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { artist: 'DJ rush meets DJ Hell' } }])
  })
})
