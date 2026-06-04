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

  it('exports in the chosen format when picked from the dropdown', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
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
      { position: 'A1', title: 'Track One' },
      { position: 'A2', title: 'Track Two' },
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
