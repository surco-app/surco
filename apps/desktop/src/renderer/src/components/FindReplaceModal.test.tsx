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
    expect(onClose).toHaveBeenCalled()
  })

  it('supports regex with $1 capture groups', () => {
    const { onApply } = renderModal([track('a', { title: 'kumara - snap' })])
    fireEvent.click(screen.getByTestId('find-replace-regex'))
    type('find-replace-find', '(.+) - (.+)')
    type('find-replace-replace', '$2 ($1)')
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { title: 'snap (kumara)' } }])
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
})
