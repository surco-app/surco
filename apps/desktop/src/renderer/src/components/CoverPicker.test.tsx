// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'

const api = {
  // The drag-prepare effect runs on mount whenever a cover is present.
  prepareCoverDrag: vi.fn().mockResolvedValue(null),
  copyCoverImage: vi.fn().mockResolvedValue(true),
  pasteCoverImage: vi.fn().mockResolvedValue(null),
  getPathForFile: vi.fn(),
  startCoverDrag: vi.fn(),
  exportCover: vi.fn(),
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = api
  vi.clearAllMocks()
})
afterEach(cleanup)

function item(over: Partial<TrackItem> = {}): TrackItem {
  return {
    inputPath: '/music/a.flac',
    fileName: 'a.flac',
    query: '',
    status: 'idle',
    listLabel: 'a.flac',
    meta: {} as TrackItem['meta'],
    ...over,
  } as TrackItem
}

function renderPicker(over: Partial<TrackItem> = {}) {
  const onChange = vi.fn()
  const onApplyCoverAll = vi.fn()
  render(
    <CoverPicker
      item={item(over)}
      isMulti={false}
      selectedTracks={undefined}
      release={null}
      coverDims={null}
      setCoverDims={vi.fn()}
      onChange={onChange}
      onApplyCoverAll={onApplyCoverAll}
    />,
  )
  return { onChange, onApplyCoverAll }
}

describe('CoverPicker copy/paste', () => {
  // Copying writes the artwork to the system clipboard so it can be pasted onto
  // another track — the source is resolved the same way an export or drag-out is.
  it('copies the artwork to the clipboard from its source on the copy button', () => {
    renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.click(screen.getByTestId('cover-copy'))
    expect(api.copyCoverImage).toHaveBeenCalledWith({
      coverUrl: 'http://img/cover.jpg',
      coverPath: undefined,
    })
  })

  // Cmd/Ctrl+C is the gesture the user asked for; it must work without clicking the
  // cover (a click opens the lightbox), so it's gated on hovering the well instead.
  it('copies with Cmd+C while the cover is hovered', () => {
    renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.mouseEnter(screen.getByTestId('cover-dropzone'))
    fireEvent.keyDown(document, { key: 'c', metaKey: true })
    expect(api.copyCoverImage).toHaveBeenCalledWith({
      coverUrl: 'http://img/cover.jpg',
      coverPath: undefined,
    })
  })

  // Gating on hover keeps the shortcut from hijacking a normal Cmd+C the user means
  // for selected text elsewhere in the app.
  it('ignores Cmd+C when the pointer is not over the cover', () => {
    renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.keyDown(document, { key: 'c', metaKey: true })
    expect(api.copyCoverImage).not.toHaveBeenCalled()
  })

  // Pasting reads the clipboard image and applies it as this track's artwork, the
  // other half of "copy here, paste there".
  it('pastes a clipboard image onto the track as its new artwork', async () => {
    api.pasteCoverImage.mockResolvedValue({
      coverUrl: 'data:image/png;base64,AAAA',
      coverPath: '/tmp/paste/cover.png',
    })
    const { onChange } = renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.mouseEnter(screen.getByTestId('cover-dropzone'))
    fireEvent.keyDown(document, { key: 'v', metaKey: true })
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        coverUrl: 'data:image/png;base64,AAAA',
        coverPath: '/tmp/paste/cover.png',
        coverRemoved: false,
      }),
    )
  })

  // An empty clipboard (nothing copied yet) leaves the track untouched rather than
  // clearing the artwork.
  it('leaves the artwork untouched when the clipboard holds no image', async () => {
    api.pasteCoverImage.mockResolvedValue(null)
    const { onChange } = renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.mouseEnter(screen.getByTestId('cover-dropzone'))
    fireEvent.keyDown(document, { key: 'v', metaKey: true })
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()
  })
})
