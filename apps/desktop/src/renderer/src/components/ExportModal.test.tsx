// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { ExportModal } from './ExportModal'

const api = {
  exportRekordbox: vi.fn().mockResolvedValue('/out/rekordbox.xml'),
  exportTraktor: vi.fn().mockResolvedValue('/out/collection.nml'),
  exportSerato: vi.fn().mockResolvedValue('/out/Surco.crate'),
  exportEngine: vi.fn().mockResolvedValue('/out/Engine Library'),
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

  // A failed write (disk full, permissions) must keep the modal open and say so —
  // closing silently reads as "the file was written" when it wasn't. The save-dialog
  // cancel resolves quietly, so only real failures surface.
  it('keeps the modal open and shows the error when the export fails', async () => {
    api.exportTraktor.mockRejectedValueOnce(new Error('disk full'))
    const onClose = vi.fn()
    render(<ExportModal tracks={[track()]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('export-traktor'))

    expect(await screen.findByTestId('export-error')).toHaveTextContent('disk full')
    expect(onClose).not.toHaveBeenCalled()
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

  // Serato's crate is binary, not text: the modal hands the IPC the raw bytes, which must
  // begin with the crate's "vrsn" version frame.
  it('writes a Serato crate when Serato is chosen', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('export-serato'))
    expect(api.exportSerato).toHaveBeenCalledTimes(1)
    const data = api.exportSerato.mock.calls[0][0] as Uint8Array
    expect(String.fromCharCode(data[0], data[1], data[2], data[3])).toBe('vrsn')
  })

  // Engine's database is built in the main process, so the modal hands the IPC the serializable
  // track payload (path + tags) plus the playlist name, not a finished file.
  it('sends the Engine payload and playlist name when Engine is chosen', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('export-engine'))
    expect(api.exportEngine).toHaveBeenCalledTimes(1)
    const [payload, playlist] = api.exportEngine.mock.calls[0]
    expect(payload[0]).toMatchObject({ path: '/music/a.wav', title: 'A' })
    expect(playlist).toBe('Surco')
  })

  // The modal must teach that it's an import bridge, not a live add — that was the user's
  // confusion about where the tracks end up.
  it('explains how to import the saved file into the DJ software', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    expect(screen.getByTestId('export-traktor')).toHaveTextContent('Import Collection')
    expect(screen.getByTestId('export-rekordbox')).toHaveTextContent('rekordbox xml')
  })

  it('closes after a target is picked and the write lands', async () => {
    const onClose = vi.fn()
    render(<ExportModal tracks={[track()]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('export-rekordbox'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
