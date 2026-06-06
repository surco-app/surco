// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { NormalizeConfig, OutputFormat, TrackMetadata } from '../../../shared/types'
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
  props: {
    requiredFields?: string[]
    visibleFields?: string[]
    showLoudness?: boolean
    normalize?: NormalizeConfig
  } = {},
): {
  onProcess: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  onDeriveTags: ReturnType<typeof vi.fn>
  onFormatChange: ReturnType<typeof vi.fn>
} {
  const onProcess = vi.fn()
  const onChange = vi.fn()
  const onDeriveTags = vi.fn()
  const onFormatChange = vi.fn()
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
      showLoudness={props.showLoudness ?? false}
      normalize={props.normalize ?? { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      searchInputRef={createRef<HTMLInputElement>()}
      onChange={onChange}
      onProcess={onProcess}
      onFormatChange={onFormatChange}
      onDeriveTags={onDeriveTags}
      onAddToAppleMusic={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  )
  return { onProcess, onChange, onDeriveTags, onFormatChange }
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

describe('Editor derive from filename', () => {
  // The control fills tags from the file name (filename → tags), the inverse of File Name's
  // Regenerate (tags → filename); it lives in the metadata header so the two never look alike.
  it('fills the track tags from its file name in one click', () => {
    const { onDeriveTags } = renderEditor({ id: 'a', fileName: '104. kumara - snap.flac' })
    fireEvent.click(screen.getByTestId('derive-btn'))
    expect(onDeriveTags).toHaveBeenCalledWith([
      { id: 'a', meta: { trackNumber: '104', artist: 'kumara', title: 'snap' } },
    ])
  })
})

describe('Editor convert button normalization note', () => {
  // Normalization must be visible at the moment of converting, not just buried in a
  // folded section — otherwise the user can't tell the export will alter loudness.
  it('flags the active normalization above the convert button', () => {
    renderEditor({ id: 'a' }, 'wav', {
      normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    })
    const note = screen.getByTestId('convert-normalize-note')
    expect(note).toHaveTextContent('-14')
  })

  it('shows no note when normalization is off', () => {
    renderEditor({ id: 'a' }, 'wav')
    expect(screen.queryByTestId('convert-normalize-note')).toBeNull()
  })
})

describe('Editor loudness pills', () => {
  // The whole point of the colour is that a non-technical user reads the verdict
  // without understanding LUFS/dBTP/LU: a near-silent, clipping, flat track is
  // wrong on all three counts and must read red across the board.
  it('grades a near-silent, clipping, flat track as bad on every pill', () => {
    renderEditor(
      {
        id: 'a',
        loudness: {
          integratedLufs: -70,
          truePeakDb: 2.5,
          lra: 0,
          channelBalanceDb: 6,
          dcOffset: 0.03,
          crestDb: 5,
          noiseFloorDb: -20,
        },
      },
      'wav',
      { showLoudness: true },
    )
    expect(screen.getByTestId('loudness-pill-lufs')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-peak')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-range')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-crest')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-balance')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-dc')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-noise')).toHaveAttribute('data-grade', 'bad')
  })

  it('grades a healthy track green on every pill', () => {
    renderEditor(
      {
        id: 'a',
        loudness: {
          integratedLufs: -12,
          truePeakDb: -1.5,
          lra: 8,
          channelBalanceDb: 0.5,
          dcOffset: 0.0001,
          crestDb: 16,
          noiseFloorDb: -55,
        },
      },
      'wav',
      { showLoudness: true },
    )
    expect(screen.getByTestId('loudness-pill-lufs')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-peak')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-range')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-crest')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-balance')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-dc')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-noise')).toHaveAttribute('data-grade', 'good')
  })

  it('drops the balance pill for a mono rip, where there is no left/right to compare', () => {
    renderEditor(
      {
        id: 'a',
        loudness: {
          integratedLufs: -12,
          truePeakDb: -1.5,
          lra: 8,
          channelBalanceDb: null,
          dcOffset: 0.0001,
          crestDb: 16,
          noiseFloorDb: -55,
        },
      },
      'wav',
      { showLoudness: true },
    )
    expect(screen.queryByTestId('loudness-pill-balance')).toBeNull()
    expect(screen.getByTestId('loudness-pill-dc')).toBeInTheDocument()
  })

  // The figures need explaining once, but must not clutter the panel on every edit,
  // so the explanation stays hidden until the user asks for it.
  it('reveals the explanation only when the help button is pressed', () => {
    renderEditor(
      {
        id: 'a',
        loudness: {
          integratedLufs: -12,
          truePeakDb: -1.5,
          lra: 8,
          channelBalanceDb: 0.5,
          dcOffset: 0.0001,
          crestDb: 16,
          noiseFloorDb: -55,
        },
      },
      'wav',
      { showLoudness: true },
    )
    expect(screen.queryByTestId('loudness-help')).toBeNull()
    fireEvent.click(screen.getByTestId('loudness-help-toggle'))
    expect(screen.getByTestId('loudness-help')).toBeInTheDocument()
  })

  it('closes the help modal on Escape, the expected way to dismiss a dialog', () => {
    renderEditor(
      {
        id: 'a',
        loudness: {
          integratedLufs: -12,
          truePeakDb: -1.5,
          lra: 8,
          channelBalanceDb: 0.5,
          dcOffset: 0.0001,
          crestDb: 16,
          noiseFloorDb: -55,
        },
      },
      'wav',
      { showLoudness: true },
    )
    fireEvent.click(screen.getByTestId('loudness-help-toggle'))
    expect(screen.getByTestId('loudness-help')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('loudness-help')).toBeNull()
  })
})

// Mirrors App's real wiring (tracks in state, updateTracksMeta over the selection) so a
// reported bug — editing one shared field, then another, only saving the first — can be
// reproduced or ruled out as a logic problem rather than a focus/UI one.
function MultiHarness() {
  const [tracks, setTracks] = useState<TrackItem[]>([
    item({ id: 'a', meta: { title: 'A', album: 'Shared' } }),
    item({ id: 'b', meta: { title: 'B', album: 'Shared' } }),
  ])
  const ids = ['a', 'b']
  const selectedTracks = tracks.filter((t) => ids.includes(t.id))
  const selected = tracks.find((t) => t.id === 'a') as TrackItem
  const updateAll = (patch: Partial<TrackMetadata>) =>
    setTracks((prev) =>
      prev.map((t) => (ids.includes(t.id) ? { ...t, meta: { ...t.meta, ...patch } } : t)),
    )
  return (
    <>
      <Editor
        key={selected.id}
        item={selected}
        hasToken
        outputFormat="aiff"
        addToAppleMusic={false}
        filenameFormat="{artist} - {title}"
        groupingPresets={[]}
        visibleFields={['title', 'album']}
        requiredFields={[]}
        showSpectrum={false}
        showLoudness={false}
        normalize={{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
        searchInputRef={createRef<HTMLInputElement>()}
        selectedTracks={selectedTracks}
        onApplyMatches={vi.fn()}
        onProcessAll={vi.fn()}
        onAddAllToAppleMusic={vi.fn()}
        onChangeAllMeta={updateAll}
        onApplyCoverAll={vi.fn()}
        onDeriveTags={vi.fn()}
        onChange={vi.fn()}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        onOpenSettings={vi.fn()}
      />
      <div data-testid="dump">
        {tracks.map((t) => `${t.id}:${t.meta.year || '-'},${t.meta.genre || '-'}`).join('|')}
      </div>
    </>
  )
}

describe('Editor multi-select sequential edits', () => {
  it('keeps applying every shared-field edit to all tracks, not just the first', () => {
    render(<MultiHarness />)
    fireEvent.change(screen.getByTestId('field-year'), { target: { value: '1999' } })
    fireEvent.change(screen.getByTestId('field-genre'), { target: { value: 'House' } })
    // Both edits must land on both tracks; the bug report is the second one being dropped.
    expect(screen.getByTestId('dump')).toHaveTextContent('a:1999,House|b:1999,House')
  })
})

describe('Editor multi-select', () => {
  function renderMulti(opts: { done?: boolean; platform?: string; music?: boolean } = {}) {
    if (opts.platform)
      (window as unknown as { api: { platform: string } }).api.platform = opts.platform
    const onChangeAllMeta = vi.fn()
    const onProcessAll = vi.fn()
    const onAddAllToAppleMusic = vi.fn()
    const onDeriveTags = vi.fn()
    const status = opts.done ? ('done' as const) : ('idle' as const)
    const a = item({
      id: 'a',
      fileName: 'kumara - one.flac',
      status,
      outputPath: opts.done ? '/out/a.aiff' : undefined,
      meta: { title: 'A', album: 'Shared' },
      spectrum: { image: '', cutoffHz: null, sampleRateHz: 44100 },
    })
    const b = item({
      id: 'b',
      fileName: 'cortina - two.flac',
      status,
      outputPath: opts.done ? '/out/b.aiff' : undefined,
      meta: { title: 'B', album: 'Shared' },
    })
    render(
      <Editor
        item={a}
        hasToken
        outputFormat="aiff"
        addToAppleMusic={opts.music ?? false}
        filenameFormat="{artist} - {title}"
        groupingPresets={[]}
        visibleFields={['title', 'album']}
        requiredFields={[]}
        showSpectrum
        showLoudness={false}
        normalize={{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
        searchInputRef={createRef<HTMLInputElement>()}
        selectedTracks={[a, b]}
        onApplyMatches={vi.fn()}
        onProcessAll={onProcessAll}
        onAddAllToAppleMusic={onAddAllToAppleMusic}
        onChangeAllMeta={onChangeAllMeta}
        onApplyCoverAll={vi.fn()}
        onDeriveTags={onDeriveTags}
        onChange={vi.fn()}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    return { onChangeAllMeta, onProcessAll, onAddAllToAppleMusic, onDeriveTags }
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

  // With the Apple Music setting on, the convert button must say so for the selection just
  // like the single-track button does, so the user knows the batch will be added too.
  it('shows the convert-all button includes Apple Music when the setting is on', () => {
    renderMulti({ platform: 'darwin', music: true })
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Apple Music')
  })

  it('writes a shared-field edit to every selected track', () => {
    const { onChangeAllMeta } = renderMulti()
    fireEvent.change(screen.getByTestId('field-album'), { target: { value: 'New Album' } })
    expect(onChangeAllMeta).toHaveBeenCalledWith({ album: 'New Album' })
  })

  it('derives tags for every selected track from its own file name in one click', () => {
    const { onDeriveTags } = renderMulti()
    fireEvent.click(screen.getByTestId('derive-btn'))
    expect(onDeriveTags).toHaveBeenCalledWith([
      { id: 'a', meta: { artist: 'kumara', title: 'one' } },
      { id: 'b', meta: { artist: 'cortina', title: 'two' } },
    ])
  })

  // The same post-convert "Add to Apple Music" button is reused for the selection rather
  // than reimplemented, so once every track is converted it adds them all in one click.
  it('reuses the Apple Music button to add the whole selection once converted', () => {
    const { onAddAllToAppleMusic } = renderMulti({ done: true, platform: 'darwin' })
    fireEvent.click(screen.getByTestId('add-apple-music'))
    expect(onAddAllToAppleMusic).toHaveBeenCalled()
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

  // Exporting to the source's own format edits the original in place rather than
  // writing a converted copy, so the button must not promise a conversion that
  // never happens — it offers to update the file instead.
  it('labels the button "Update" when the export format matches the source', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'wav')
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Update')
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

  // The keyboard convert shortcuts (⌘⏎) live in App and only know the chosen
  // format through this callback, so picking one must report it up.
  it('reports the picked format so the keyboard shortcut can match it', () => {
    const { onFormatChange } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onFormatChange).toHaveBeenCalledWith('mp3')
  })
})

describe('Editor output file name', () => {
  // Users complained that loading a file and converting renamed it from metadata.
  // The field must default to the source file's own name, leaving any rename opt-in.
  it('defaults the output name to the original file name, not the metadata', () => {
    renderEditor(
      { id: 'a', fileName: 'original track 01', meta: { artist: 'AR', title: 'TI' } },
      'wav',
    )
    expect(screen.getByTestId('output-name')).toHaveValue('original track 01')
  })

  // The rename is opt-in: pressing Regenerate is the one action that swaps the file
  // name for the metadata-derived one ("{artist} - {title}").
  it('fills the output name from metadata only when Regenerate is clicked', () => {
    const { onChange } = renderEditor(
      { id: 'a', fileName: 'original track 01', meta: { artist: 'AR', title: 'TI' } },
      'wav',
    )
    fireEvent.click(screen.getByTestId('regenerate-output-name'))
    expect(onChange).toHaveBeenCalledWith({ outputName: 'AR - TI' })
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
