// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { StripNumberingModal } from './StripNumberingModal'

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

function track(id: string, title: string, trackNumber = ''): TrackItem {
  return {
    id,
    inputPath: `/m/${id}`,
    fileName: `${id}.flac`,
    listLabel: title,
    query: '',
    status: 'idle',
    meta: { ...emptyMeta, title, trackNumber },
  }
}

function renderModal(tracks: TrackItem[]) {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<StripNumberingModal tracks={tracks} onApply={onApply} onClose={onClose} />)
  return { onApply, onClose }
}

describe('StripNumberingModal', () => {
  it('exposes an accessible name on the dialog', () => {
    renderModal([track('a', '1. Shake It')])
    expect(screen.getByRole('dialog')).toHaveAccessibleName()
  })

  it('patches only the titles that carry numbering, leaving the rest untouched', () => {
    // The reported bug in one batch: the plain number gets cleaned, the vinyl position
    // is no longer collateral damage, and a clean title is not rewritten for nothing.
    const { onApply, onClose } = renderModal([
      track('a', '1. Shake It'),
      track('b', 'A1. Deep Cut'),
      track('c', 'Already Clean'),
    ])
    fireEvent.click(screen.getByTestId('strip-numbering-apply'))
    expect(onApply).toHaveBeenCalledWith([
      { id: 'a', meta: { title: 'Shake It' } },
      { id: 'b', meta: { title: 'Deep Cut' } },
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('uses each track’s own position to clear separator-less numbering', () => {
    // The rips that read "05 Last One": only the track's tagged position tells them
    // apart from a title like "7 Seconds", so the modal must feed it through.
    const { onApply } = renderModal([track('a', '05 Last One', '5'), track('b', '7 Seconds', '3')])
    fireEvent.click(screen.getByTestId('strip-numbering-apply'))
    expect(onApply).toHaveBeenCalledWith([{ id: 'a', meta: { title: 'Last One' } }])
  })

  it('previews before→after so a bulk rewrite is never applied blind', () => {
    renderModal([track('a', '1. Shake It')])
    const preview = screen.getByTestId('strip-numbering-preview')
    expect(preview).toHaveTextContent('1. Shake It')
    expect(preview).toHaveTextContent('Shake It')
  })

  it('disables apply when no title carries numbering, instead of a silent no-op', () => {
    const { onApply } = renderModal([track('a', 'Already Clean'), track('b', '1999')])
    const apply = screen.getByTestId('strip-numbering-apply')
    expect(apply).toBeDisabled()
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
  })
})
