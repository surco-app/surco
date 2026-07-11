// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { TrackItem } from '../types'
import { CoverPicker } from './CoverPicker'

const api = {
  // The drag-prepare effect runs on mount whenever a cover is present.
  prepareCoverDrag: vi.fn().mockResolvedValue(null),
  copyCoverImage: vi.fn().mockResolvedValue(true),
  pasteCoverImage: vi.fn().mockResolvedValue(null),
  // A browser-dragged image is resolved in main; default to "no usable image found".
  resolveDraggedCover: vi.fn().mockResolvedValue(null),
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
  // The action bar renders one button per action; a duplicate export icon shipped once,
  // so this guards each action appears exactly once on a filled single-track cover.
  it('renders each cover action exactly once', () => {
    renderPicker({ coverUrl: 'http://img/cover.jpg' })
    expect(screen.getAllByTestId('cover-copy')).toHaveLength(1)
    expect(screen.getAllByTestId('cover-paste')).toHaveLength(1)
    expect(screen.getAllByTestId('cover-export')).toHaveLength(1)
    expect(screen.getAllByTestId('cover-remove')).toHaveLength(1)
  })

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

describe('CoverPicker drag and counter', () => {
  const release = {
    id: 1,
    title: 'Album',
    images: [{ uri: 'http://a/1.jpg' }, { uri: 'http://a/2.jpg' }],
  } as unknown as React.ComponentProps<typeof CoverPicker>['release']

  function renderWithRelease(over: Partial<TrackItem> = {}) {
    const onChange = vi.fn()
    render(
      <CoverPicker
        item={item(over)}
        isMulti={false}
        selectedTracks={undefined}
        release={release}
        coverDims={null}
        setCoverDims={vi.fn()}
        onChange={onChange}
        onApplyCoverAll={vi.fn()}
      />,
    )
    return { onChange }
  }

  // An image dragged from a browser arrives as URLs with no File. Main resolves them to
  // the first real image — a CSP-safe data-URL preview plus a local path — which we apply
  // like a picked file. A raw remote URL would render as a broken thumbnail under the CSP.
  it('resolves an image dragged from a browser and applies it as the cover', async () => {
    api.resolveDraggedCover.mockResolvedValueOnce({
      coverUrl: 'data:image/jpeg;base64,AAAA',
      coverPath: '/tmp/cover.jpg',
    })
    const onChange = vi.fn()
    render(
      <CoverPicker
        item={item()}
        isMulti={false}
        selectedTracks={undefined}
        release={null}
        coverDims={null}
        setCoverDims={vi.fn()}
        onChange={onChange}
        onApplyCoverAll={vi.fn()}
      />,
    )
    fireEvent.drop(screen.getByTestId('cover-dropzone'), {
      dataTransfer: {
        files: [],
        getData: (t: string) => (t === 'text/uri-list' ? 'https://img.example/cover.jpg' : ''),
      },
    })
    await waitFor(() =>
      expect(api.resolveDraggedCover).toHaveBeenCalledWith(['https://img.example/cover.jpg']),
    )
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          coverUrl: 'data:image/jpeg;base64,AAAA',
          coverPath: '/tmp/cover.jpg',
          coverRemoved: false,
        }),
      ),
    )
  })

  // A drag whose URLs resolve to no real image (a link to a page, not a picture) must
  // leave the artwork untouched rather than apply a broken cover or raise an error.
  it('leaves the artwork untouched when no dragged URL resolves to an image', async () => {
    api.resolveDraggedCover.mockResolvedValueOnce(null)
    const onChange = vi.fn()
    render(
      <CoverPicker
        item={item()}
        isMulti={false}
        selectedTracks={undefined}
        release={null}
        coverDims={null}
        setCoverDims={vi.fn()}
        onChange={onChange}
        onApplyCoverAll={vi.fn()}
      />,
    )
    fireEvent.drop(screen.getByTestId('cover-dropzone'), {
      dataTransfer: {
        files: [],
        getData: (t: string) => (t === 'text/uri-list' ? 'https://a-page.example/article' : ''),
      },
    })
    await waitFor(() => expect(api.resolveDraggedCover).toHaveBeenCalled())
    expect(onChange).not.toHaveBeenCalled()
  })

  // A browser-dragged URL ffmpeg can't decode makes the drag-out prepare reject. That
  // failure is best-effort — drag-out just stays unavailable — so it must be swallowed,
  // never escape as an unhandled rejection that the app surfaces as a red error toast.
  it('swallows a failed drag-out prepare instead of letting it surface', async () => {
    api.prepareCoverDrag.mockRejectedValueOnce(new Error('ffmpeg: No JPEG data found in image'))
    renderWithRelease({ coverUrl: 'https://img.example/broken.jpg' })
    await waitFor(() => expect(api.prepareCoverDrag).toHaveBeenCalled())
    // Let the rejected prepare promise settle; without a .catch this is an unhandled
    // rejection, which Vitest fails the run on.
    await act(async () => {})
    fireEvent.dragStart(screen.getByTestId('cover-preview'))
    expect(api.startCoverDrag).not.toHaveBeenCalled()
  })

  // After deleting the cover the choices remain (so the arrows can step back into them),
  // but nothing is selected: the counter must read "0/2", never a stray "–/2".
  it('shows 0/N in the counter when no cover is selected', () => {
    renderWithRelease({ coverUrl: undefined })
    expect(screen.getByTestId('cover-image-count')).toHaveTextContent('0/2')
  })

  // Discogs often returns the same image under several entries (a primary plus secondaries
  // that point at the same resource). Pushing each entry as its own choice left the stepper
  // cycling through identical-looking slots, so the user clicked next and the cover didn't
  // change. The choices are deduped by uri, so each distinct cover is one slot.
  it('does not repeat a release image that appears more than once', () => {
    const dupRelease = {
      id: 2,
      title: 'Album',
      images: [
        { uri: 'http://a/1.jpg' },
        { uri: 'http://a/1.jpg' },
        { uri: 'http://a/2.jpg' },
      ],
    } as unknown as React.ComponentProps<typeof CoverPicker>['release']
    render(
      <CoverPicker
        item={item({ coverUrl: undefined })}
        isMulti={false}
        selectedTracks={undefined}
        release={dupRelease}
        coverDims={null}
        setCoverDims={vi.fn()}
        onChange={vi.fn()}
        onApplyCoverAll={vi.fn()}
      />,
    )
    // Three image entries, two distinct covers — the duplicate collapses to one slot.
    expect(screen.getByTestId('cover-image-count')).toHaveTextContent('0/2')
  })

  // The metadata read fills embeddedCover asynchronously; clicking a row right after
  // import mounts the picker before it lands. The original's slot must still appear once
  // the read delivers it — captured only at mount, a one-image release left a single
  // choice and no arrows, so the user couldn't step between their art and the release's.
  it('adds the original slot when the embedded cover arrives after mount', () => {
    const oneImageRelease = {
      id: 3,
      title: 'Album',
      images: [{ uri: 'http://a/1.jpg' }],
    } as unknown as React.ComponentProps<typeof CoverPicker>['release']
    const props = {
      isMulti: false,
      selectedTracks: undefined,
      release: oneImageRelease,
      coverDims: null,
      setCoverDims: vi.fn(),
      onChange: vi.fn(),
      onApplyCoverAll: vi.fn(),
    }
    const { rerender } = render(<CoverPicker item={item()} {...props} />)
    expect(screen.queryByTestId('cover-image-picker')).not.toBeInTheDocument()
    rerender(
      <CoverPicker
        item={item({ coverUrl: 'blob:original', embeddedCover: 'blob:original' })}
        {...props}
      />,
    )
    expect(screen.getByTestId('cover-image-count')).toHaveTextContent('1/2')
  })

  // The workflow the user relies on after applying a release: it keeps the file's own
  // cover rather than forcing the release art over it, and the arrows step from that
  // cover into the release's images — forward and back — so the release art is always one
  // step away. This guards against a regression where the release images stop being
  // reachable from a track that already carries a cover.
  it('steps from the kept file cover into the release images with the arrows', () => {
    const { onChange } = renderWithRelease({
      coverUrl: 'http://file/original.jpg',
      embeddedCover: 'http://file/original.jpg',
    })
    // The file's own cover sits at index 0, the two release images after it.
    expect(screen.getByTestId('cover-image-count')).toHaveTextContent('1/3')
    fireEvent.click(screen.getByTestId('cover-next'))
    expect(onChange).toHaveBeenLastCalledWith({
      coverUrl: 'http://a/1.jpg',
      coverPath: undefined,
      coverRemoved: false,
    })
    // Stepping back from the original wraps to the last release image, so both directions
    // reach the release art.
    fireEvent.click(screen.getByTestId('cover-prev'))
    expect(onChange).toHaveBeenLastCalledWith({
      coverUrl: 'http://a/2.jpg',
      coverPath: undefined,
      coverRemoved: false,
    })
  })
})
