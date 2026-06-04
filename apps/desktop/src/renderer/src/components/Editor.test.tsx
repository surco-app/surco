// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { OutputFormat } from '../../../shared/types'
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

function item(over: Partial<TrackItem> & { id: string }): TrackItem {
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
  over: Partial<TrackItem> & { id: string },
  outputFormat: OutputFormat = 'wav',
): { onProcess: ReturnType<typeof vi.fn> } {
  const onProcess = vi.fn()
  render(
    <Editor
      item={item(over)}
      hasToken
      outputFormat={outputFormat}
      addToAppleMusic={false}
      filenameFormat="{artist} - {title}"
      groupingPresets={[]}
      visibleFields={[]}
      requiredFields={[]}
      showSpectrum={false}
      searchInputRef={createRef<HTMLInputElement>()}
      onChange={vi.fn()}
      onProcess={onProcess}
      onAddToAppleMusic={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  )
  return { onProcess }
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
