// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { DeriveFromFilename } from './DeriveFromFilename'

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

function track(id: string, fileName: string): TrackItem {
  return { id, inputPath: `/m/${fileName}`, fileName, query: '', status: 'idle', meta: emptyMeta }
}

function renderDerive(files: TrackItem[]) {
  const onApply = vi.fn()
  render(<DeriveFromFilename files={files} onApply={onApply} />)
  return { onApply }
}

describe('DeriveFromFilename', () => {
  it('previews what the default pattern would pull from the first file', () => {
    renderDerive([track('a', 'kumara - snap ya fingaz.flac')])
    expect(screen.getByTestId('derive-preview-artist')).toHaveTextContent('kumara')
    expect(screen.getByTestId('derive-preview-title')).toHaveTextContent('snap ya fingaz')
  })

  it('derives each file from its own name and applies one patch per track', () => {
    const { onApply } = renderDerive([
      track('a', 'kumara - one.flac'),
      track('b', 'cortina - two.flac'),
    ])
    fireEvent.click(screen.getByTestId('derive-apply'))
    expect(onApply).toHaveBeenCalledWith([
      { id: 'a', meta: { artist: 'kumara', title: 'one' } },
      { id: 'b', meta: { artist: 'cortina', title: 'two' } },
    ])
  })

  it('disables apply and explains when the name does not fit the pattern', () => {
    renderDerive([track('a', 'noseparator.flac')])
    expect(screen.getByTestId('derive-nomatch')).toBeInTheDocument()
    expect(screen.getByTestId('derive-apply')).toBeDisabled()
  })

  it('re-derives from a custom pattern the user types', () => {
    const { onApply } = renderDerive([track('a', '104. kumara - snap.flac')])
    fireEvent.change(screen.getByTestId('derive-pattern'), {
      target: { value: '{trackNumber}. {artist} - {title}' },
    })
    fireEvent.click(screen.getByTestId('derive-apply'))
    expect(onApply).toHaveBeenCalledWith([
      { id: 'a', meta: { trackNumber: '104', artist: 'kumara', title: 'snap' } },
    ])
  })
})
