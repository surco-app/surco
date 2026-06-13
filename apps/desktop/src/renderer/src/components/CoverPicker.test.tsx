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
  // The paste affordance checks the clipboard on mount/focus; default to empty so the
  // button is absent unless a test opts in.
  hasClipboardImage: vi.fn().mockResolvedValue(false),
  onWindowFocus: vi.fn(() => () => {}),
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
    api.hasClipboardImage.mockResolvedValue(false)
    const { onChange } = renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.mouseEnter(screen.getByTestId('cover-dropzone'))
    fireEvent.keyDown(document, { key: 'v', metaKey: true })
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()
  })

  // The paste button only exists when there's an image to paste — the user's question:
  // "how do I paste it?" Discoverable button, not a hidden shortcut.
  it('shows a paste button when the clipboard holds an image and pastes onto the track', async () => {
    api.hasClipboardImage.mockResolvedValue(true)
    api.pasteCoverImage.mockResolvedValue({
      coverUrl: 'data:image/png;base64,BBBB',
      coverPath: '/tmp/paste/cover.png',
    })
    const { onChange } = renderPicker({ coverUrl: 'http://img/cover.jpg' })
    fireEvent.click(await screen.findByTestId('cover-paste'))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        coverUrl: 'data:image/png;base64,BBBB',
        coverPath: '/tmp/paste/cover.png',
        coverRemoved: false,
      }),
    )
  })

  // With nothing on the clipboard the paste button stays in place but disabled, so the
  // bar never shifts as an icon pops in and out.
  it('disables the paste button when the clipboard has no image', async () => {
    api.hasClipboardImage.mockResolvedValue(false)
    renderPicker({ coverUrl: 'http://img/cover.jpg' })
    // Let the on-mount clipboard check settle before asserting it stayed disabled.
    await waitFor(() => expect(api.hasClipboardImage).toHaveBeenCalled())
    expect(screen.getByTestId('cover-paste')).toBeDisabled()
  })

  // A track with no artwork can still receive a paste — the button shows over the empty
  // drop well too, so copying from one track onto untagged ones works.
  it('offers the paste button on a coverless track', async () => {
    api.hasClipboardImage.mockResolvedValue(true)
    renderPicker({})
    expect(await screen.findByTestId('cover-paste')).toBeInTheDocument()
  })
})
