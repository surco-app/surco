// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { ExportModal } from './ExportModal'

const api = {
  exportRekordbox: vi.fn().mockResolvedValue('/out/rekordbox.xml'),
  exportTraktor: vi.fn().mockResolvedValue('/out/collection.nml'),
}

beforeEach(() => {
  Object.assign(window, { api })
  vi.clearAllMocks()
  void i18n.changeLanguage('en')
})
afterEach(cleanup)

const track = (): TrackItem =>
  ({
    id: 'a',
    inputPath: '/music/a.wav',
    fileName: 'a.wav',
    query: '',
    status: 'idle',
    meta: {
      title: 'A',
      artist: 'B',
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
    },
  }) as TrackItem

describe('ExportModal', () => {
  it('exposes an accessible name on the dialog', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName()
  })

  // One Export entry point routes to the right collection writer by what the user picks.
  it('writes a Traktor NML when Traktor is chosen', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('export-traktor'))
    expect(api.exportTraktor).toHaveBeenCalledTimes(1)
    expect(api.exportTraktor.mock.calls[0][0]).toContain('<NML VERSION="19">')
  })

  it('writes a rekordbox XML when rekordbox is chosen', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('export-rekordbox'))
    expect(api.exportRekordbox).toHaveBeenCalledTimes(1)
    expect(api.exportRekordbox.mock.calls[0][0]).toContain('<DJ_PLAYLISTS')
  })

  // The modal must teach that it's an import bridge, not a live add — that was the user's
  // confusion about where the tracks end up.
  it('explains how to import the saved file into the DJ software', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    expect(screen.getByTestId('export-traktor')).toHaveTextContent('Import Collection')
    expect(screen.getByTestId('export-rekordbox')).toHaveTextContent('rekordbox xml')
  })

  it('closes after a target is picked', () => {
    const onClose = vi.fn()
    render(<ExportModal tracks={[track()]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('export-rekordbox'))
    expect(onClose).toHaveBeenCalled()
  })
})
