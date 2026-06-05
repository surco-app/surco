// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { BulkEditor } from './BulkEditor'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
    inputPath: `/music/${id}.flac`,
    fileName: `${id}.flac`,
    query: '',
    status: 'idle',
    meta: { ...emptyMeta, ...meta },
  }
}

function renderBulk(tracks: TrackItem[]) {
  const onChangeMeta = vi.fn()
  const onApplyCover = vi.fn()
  const onApplyMatches = vi.fn()
  render(
    <BulkEditor
      tracks={tracks}
      onChangeMeta={onChangeMeta}
      onApplyCover={onApplyCover}
      onApplyMatches={onApplyMatches}
    />,
  )
  return { onChangeMeta, onApplyCover, onApplyMatches }
}

describe('BulkEditor', () => {
  it('shows the shared value of a field the tracks agree on', () => {
    renderBulk([track('a', { album: 'Hard House Nation' }), track('b', { album: 'Hard House Nation' })])
    expect(screen.getByTestId('bulk-field-album')).toHaveValue('Hard House Nation')
  })

  // The whole point of the mixed state: a field where the tracks differ stays blank so
  // bulk-editing never silently flattens real per-track differences into one value.
  it('leaves a field blank and hints "multiple values" when the tracks differ', () => {
    renderBulk([track('a', { artist: 'Kumara' }), track('b', { artist: 'B.F.I.' })])
    const input = screen.getByTestId('bulk-field-artist')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'Multiple values')
  })

  it('applies an edit to every selected track via a metadata patch', () => {
    const { onChangeMeta } = renderBulk([track('a', {}), track('b', {})])
    fireEvent.change(screen.getByTestId('bulk-field-genre'), { target: { value: 'Hard House' } })
    expect(onChangeMeta).toHaveBeenCalledWith({ genre: 'Hard House' })
  })

  it('does not expose per-track fields like title, which bulk editing must not flatten', () => {
    renderBulk([track('a', {}), track('b', {})])
    expect(screen.queryByTestId('bulk-field-title')).toBeNull()
    expect(screen.queryByTestId('bulk-field-trackNumber')).toBeNull()
  })

  // One album cover dropped on the bulk panel should hand the same image to the caller,
  // which stamps it onto every selected track at once.
  it('reports a dropped image so it can be applied to the whole selection', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:cover' })
    ;(window as unknown as { api: unknown }).api = { getPathForFile: () => '/img/cover.png' }
    const { onApplyCover } = renderBulk([track('a', {}), track('b', {})])
    const file = new File(['x'], 'cover.png', { type: 'image/png' })
    fireEvent.drop(screen.getByTestId('bulk-cover-drop'), { dataTransfer: { files: [file] } })
    expect(onApplyCover).toHaveBeenCalledWith('blob:cover', '/img/cover.png')
  })

  // Clicking the zone must work the same as a drop, so a user can browse the filesystem
  // for the artwork instead of having to drag it.
  it('reports an image picked through the file input', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:picked' })
    ;(window as unknown as { api: unknown }).api = { getPathForFile: () => '/img/picked.jpg' }
    const { onApplyCover } = renderBulk([track('a', {}), track('b', {})])
    const file = new File(['x'], 'picked.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('bulk-cover-input'), { target: { files: [file] } })
    expect(onApplyCover).toHaveBeenCalledWith('blob:picked', '/img/picked.jpg')
  })
})
