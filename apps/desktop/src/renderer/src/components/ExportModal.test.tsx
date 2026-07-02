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
  exportM3u: vi.fn().mockResolvedValue('/out/surco.m3u8'),
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

  // The playlist bridge for everything that isn't DJ software: one row, one plain
  // UTF-8 file, converted copies preferred like every other export.
  it('exports an extended M3U8 playlist when M3U8 is chosen', () => {
    render(<ExportModal tracks={[track()]} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('export-m3u'))
    expect(api.exportM3u).toHaveBeenCalledTimes(1)
    const m3u = api.exportM3u.mock.calls[0][0] as string
    expect(m3u.startsWith('#EXTM3U\n')).toBe(true)
    expect(m3u).toContain('/music/a.wav')
  })

  // Engine's database is built in the main process, so the modal hands the IPC the serializable
  // track payload (path + tags) plus the playlist name, not a finished file.
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

  // An unconverted track exports its original source path (the builders fall back to
  // inputPath), so the DJ's library would point at the un-renamed, un-normalized file. The
  // export still works, but the user must be warned they're exporting originals, not copies.
  it('warns when some tracks have not been converted', () => {
    render(
      <ExportModal tracks={[track(), { ...track(), outputPath: '/out/b.aiff' }]} onClose={vi.fn()} />,
    )
    expect(screen.getByTestId('export-unconverted')).toHaveTextContent('1')
  })

  // Every track converted: the export points at the good copies, so there's nothing to warn
  // about and the notice stays out of the way.
  it('shows no warning when every track has been converted', () => {
    render(<ExportModal tracks={[{ ...track(), outputPath: '/out/a.aiff' }]} onClose={vi.fn()} />)
    expect(screen.queryByTestId('export-unconverted')).toBeNull()
  })
})
