// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { OutputFormat, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { Editor } from './Editor'

afterEach(cleanup)

// Editor mounts effects that touch window.api; a non-darwin platform skips the
// Apple Music lookup and showSpectrum={false} skips the spectrogram analysis, so
// the bridge only needs `platform` and the handful of methods used on click.
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    reveal: vi.fn(),
  }
})

function item(
  over: Partial<Omit<TrackItem, 'meta'>> & { id: string; meta?: Partial<TrackMetadata> },
): TrackItem {
  return {
    inputPath: `/music/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    query: '',
    status: 'idle',
    ...over,
    meta: {
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
      ...over.meta,
    },
  }
}

function renderEditor(
  over: Partial<Omit<TrackItem, 'meta'>> & { id: string; meta?: Partial<TrackMetadata> },
  outputFormat: OutputFormat = 'wav',
  props: { requiredFields?: string[]; visibleFields?: string[] } = {},
): { onProcess: ReturnType<typeof vi.fn>; onChange: ReturnType<typeof vi.fn> } {
  const onProcess = vi.fn()
  const onChange = vi.fn()
  render(
    <Editor
      item={item(over)}
      hasToken
      outputFormat={outputFormat}
      addToAppleMusic={false}
      filenameFormat="{artist} - {title}"
      groupingPresets={[]}
      visibleFields={props.visibleFields ?? []}
      requiredFields={props.requiredFields ?? []}
      showSpectrum={false}
      searchInputRef={createRef<HTMLInputElement>()}
      onChange={onChange}
      onProcess={onProcess}
      onAddToAppleMusic={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  )
  return { onProcess, onChange }
}

describe('Editor cover picker', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Artwork must be reachable by clicking to browse the filesystem, not only by drag —
  // many users never think to drag an image onto the empty cover well.
  it('applies an image chosen through the file input', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:cover' })
    ;(window as unknown as { api: Record<string, unknown> }).api.getPathForFile = () => '/img/c.png'
    const { onChange } = renderEditor({ id: 'a' })
    const file = new File(['x'], 'c.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('cover-input'), { target: { files: [file] } })
    expect(onChange).toHaveBeenCalledWith({ coverUrl: 'blob:cover', coverPath: '/img/c.png' })
  })
})

describe('Editor multi-select', () => {
  function renderMulti() {
    const onChangeAllMeta = vi.fn()
    const onProcessAll = vi.fn()
    const a = item({
      id: 'a',
      meta: { title: 'A', album: 'Shared' },
      spectrum: { image: '', cutoffHz: null, sampleRateHz: 44100 },
    })
    const b = item({ id: 'b', meta: { title: 'B', album: 'Shared' } })
    render(
      <Editor
        item={a}
        hasToken
        outputFormat="aiff"
        addToAppleMusic={false}
        filenameFormat="{artist} - {title}"
        groupingPresets={[]}
        visibleFields={['title', 'album']}
        requiredFields={[]}
        showSpectrum
        searchInputRef={createRef<HTMLInputElement>()}
        selectedTracks={[a, b]}
        onApplyMatches={vi.fn()}
        onProcessAll={onProcessAll}
        onChangeAllMeta={onChangeAllMeta}
        onApplyCoverAll={vi.fn()}
        onChange={vi.fn()}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    return { onChangeAllMeta, onProcessAll }
  }

  // The spectrum and output filename describe a single file; over a multi-selection they
  // are meaningless, so they must drop out rather than show the primary track's by accident.
  it('hides the per-track spectrum and filename when several tracks are selected', () => {
    renderMulti()
    expect(screen.queryByText(i18n.t('editor.qualityTitle'))).toBeNull()
    expect(screen.queryByTestId('output-name')).toBeNull()
  })

  it('shows shared album fields and a convert-all action with the format picker', () => {
    renderMulti()
    expect(screen.getByTestId('field-album')).toHaveValue('Shared')
    expect(screen.queryByTestId('field-title')).toBeNull()
    // The convert button keeps the format split-control, but converts the whole selection.
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Convert all (2)')
    expect(screen.getByTestId('process-format-toggle')).toBeInTheDocument()
  })

  it('converts every selected track in the chosen format', () => {
    const { onProcessAll } = renderMulti()
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcessAll).toHaveBeenCalledWith('aiff')
  })

  it('writes a shared-field edit to every selected track', () => {
    const { onChangeAllMeta } = renderMulti()
    fireEvent.change(screen.getByTestId('field-album'), { target: { value: 'New Album' } })
    expect(onChangeAllMeta).toHaveBeenCalledWith({ album: 'New Album' })
  })
})

describe('Editor export control', () => {
  // The original bug: once a track was done its export button vanished, so a user
  // who exported WAV had no way to also export MP3 without reloading the file.
  it('keeps the export button visible after the track is done', () => {
    renderEditor({ id: 'a', status: 'done', outputPath: '/out/a.wav' })
    expect(screen.getByTestId('process-btn')).toBeInTheDocument()
  })

  it('exports in the settings default format when the main button is clicked', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalledWith('wav')
  })

  // Picking a format from the dropdown used to convert on the spot, so a misclick
  // wrote a file. The dropdown now only chooses the format; conversion waits for a
  // deliberate click on the main button.
  it('does not convert when a format is picked from the dropdown', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onProcess).not.toHaveBeenCalled()
  })

  it('relabels the main button to the format chosen from the dropdown', () => {
    renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(screen.getByTestId('process-btn')).toHaveTextContent('MP3')
  })

  it('exports in the chosen format when the main button is clicked after picking it', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalledTimes(1)
    expect(onProcess).toHaveBeenCalledWith('mp3')
  })
})

describe('Editor required-field gate', () => {
  // The convert button used to fail late: it stayed enabled with empty required
  // fields and only surfaced the error after the click. Disabling it until the
  // fields are filled turns a dead-end error into clear, upfront guidance.
  it('disables both convert buttons while a required field is empty', () => {
    renderEditor({ id: 'a', meta: { artist: '' } }, 'wav', { requiredFields: ['artist'] })
    expect(screen.getByTestId('process-btn')).toBeDisabled()
    expect(screen.getByTestId('process-format-toggle')).toBeDisabled()
  })

  it('enables the convert button once every required field has a value', () => {
    renderEditor({ id: 'a', meta: { artist: 'Alex Ponce' } }, 'wav', {
      requiredFields: ['artist'],
    })
    expect(screen.getByTestId('process-btn')).toBeEnabled()
  })

  // The disabled button needs a reason: flag the empty required field as invalid
  // straight away, not only after a (now impossible) failed convert attempt.
  it('marks an empty required field as invalid before any convert attempt', () => {
    renderEditor({ id: 'a', status: 'idle', meta: { artist: '' } }, 'wav', {
      requiredFields: ['artist'],
      visibleFields: ['artist'],
    })
    expect(screen.getByTestId('field-artist')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Editor Discogs apply', () => {
  const searchResult = { id: 1, title: 'Some Album', cover_image: 'cover.jpg' }
  const release = {
    id: 1,
    title: 'Some Album',
    artists: [{ name: 'The Artist' }],
    tracklist: [
      { position: 'A1', title: 'Track One', duration: '3:21' },
      { position: 'A2', title: 'Track Two', duration: '7:45' },
    ],
  }

  function withDiscogs(): { getRelease: ReturnType<typeof vi.fn> } {
    const getRelease = vi.fn().mockResolvedValue(release)
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      reveal: vi.fn(),
      searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
      getRelease,
    }
    return { getRelease }
  }

  async function search(): Promise<void> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.click(screen.getByTestId('discogs-search'))
    await screen.findByTestId('discogs-result')
  }

  // The album row used to apply its best-guess track on a hidden double-click,
  // silently overwriting the user's edits. Browsing results must never mutate the
  // song; loading the release (getRelease) only happens on a deliberate action.
  it('does not apply metadata when the album row is double-clicked', async () => {
    const { getRelease } = withDiscogs()
    renderEditor({ id: 'a' })
    await search()
    fireEvent.doubleClick(screen.getByTestId('discogs-result'))
    expect(getRelease).not.toHaveBeenCalled()
  })

  // The discoverable, explicit path: expand the album, then pick the track. That
  // single click is what applies the metadata.
  it('applies a track when it is picked from the expanded album', async () => {
    withDiscogs()
    const { onChange } = renderEditor({ id: 'a' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange).toHaveBeenCalled()
  })

  // Discogs returns each track's length; showing it next to the title is what lets
  // the user match the rip they have against the right tracklist entry by time.
  it('shows each track length from the Discogs tracklist', async () => {
    withDiscogs()
    renderEditor({ id: 'a' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    const rows = await screen.findAllByTestId('discogs-track')
    expect(rows[0]).toHaveTextContent('3:21')
    expect(rows[1]).toHaveTextContent('7:45')
  })
})

describe('Editor track preselection', () => {
  const searchResult = { id: 2, title: 'Some Album', cover_image: 'cover.jpg' }
  const release = {
    id: 2,
    title: 'Some Album',
    artists: [{ name: 'The Artist' }],
    tracklist: [
      { position: 'A1', title: 'Track One' },
      { position: 'A2', title: 'Track Two (Remix)' },
    ],
  }

  function withDiscogs(): void {
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      reveal: vi.fn(),
      searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
      getRelease: vi.fn().mockResolvedValue(release),
    }
  }

  async function loadTracklist(): Promise<HTMLElement[]> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.click(screen.getByTestId('discogs-search'))
    fireEvent.click(await screen.findByTestId('discogs-result'))
    return screen.findAllByTestId('discogs-track')
  }

  // The file's title rarely matches the Discogs spelling exactly — punctuation and
  // case differ — so an exact compare would highlight nothing. The fuzzy match
  // preselects the right mix from the filename so the user doesn't hunt for it.
  it('preselects the tracklist entry that best matches the file title', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    const rows = await loadTracklist()
    const remix = rows.find((r) => r.textContent?.includes('Track Two (Remix)'))
    const other = rows.find((r) => r.textContent?.includes('Track One'))
    expect(remix).toHaveAttribute('aria-current', 'true')
    expect(other).not.toHaveAttribute('aria-current')
  })

  // A confident preselection (exact title) and a shakier one (a partial match)
  // should not look the same: the badge tells the user whether to trust the
  // highlight or double-check it, which is what makes a batch auto-match safe.
  it('marks an exact-title preselection as a confident match', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    await loadTracklist()
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute('data-confidence', 'high')
  })

  it('flags a partial-title preselection for review', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two' } })
    await loadTracklist()
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute(
      'data-confidence',
      'review',
    )
  })

  // A weak match — one incidental shared word — is "too weak to trust", so it must
  // neither preselect a row nor show a tick. Otherwise loading an unrelated release
  // still badges a random mix and invites the user to apply the wrong one.
  it('does not preselect or badge a low-confidence match', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track elsewhere entirely' } })
    const rows = await loadTracklist()
    expect(rows.some((r) => r.getAttribute('aria-current') === 'true')).toBe(false)
    expect(screen.queryByTestId('track-confidence')).toBeNull()
  })
})

describe('Editor in-place hint', () => {
  // A WAV source exported as WAV is edited (and renamed) in place; the user should
  // know the original file changes rather than a copy appearing in the output folder.
  it('warns about the in-place edit when the format matches the source', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'wav')
    expect(screen.getByTestId('output-name-hint')).toHaveTextContent(
      i18n.t('editor.outputNameHintInPlace'),
    )
  })

  it('shows the generic hint when the export converts to a different format', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'mp3')
    expect(screen.getByTestId('output-name-hint')).toHaveTextContent(
      i18n.t('editor.outputNameHint'),
    )
  })
})
