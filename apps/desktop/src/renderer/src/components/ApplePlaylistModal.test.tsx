// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppleMusicPlaylist } from '../../../shared/types'
import { ApplePlaylistModal } from './ApplePlaylistModal'

const loadAppleMusicPlaylists = vi.fn()

beforeEach(() => {
  loadAppleMusicPlaylists.mockReset()
  ;(window as unknown as { api: unknown }).api = { loadAppleMusicPlaylists }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LISTS: AppleMusicPlaylist[] = [
  { name: 'Sesión sábado', count: 128, persistentId: 'A1B2C3D4E5F60718' },
  { name: 'Remember 90s', count: 612, persistentId: 'FFEEDDCCBBAA9988' },
  { name: 'Por clasificar', count: 0, persistentId: '0011223344556677' },
]

function setup(over: Partial<Parameters<typeof ApplePlaylistModal>[0]> = {}): {
  onPick: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<ApplePlaylistModal onPick={onPick} onClose={onClose} {...over} />)
  return { onPick, onClose }
}

describe('ApplePlaylistModal', () => {
  it('lists the playlists with what each holds', async () => {
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    setup()

    expect(await screen.findByText('Sesión sábado')).toBeTruthy()
    expect(screen.getByText('612')).toBeTruthy()
  })

  it('hands back the playlist the user picked, by identity and name', async () => {
    // The persistent ID is what the import re-finds the playlist by; the name only
    // travels so the status bar can say which crate arrived.
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    const { onPick } = setup()

    fireEvent.click(await screen.findByText('Remember 90s'))
    fireEvent.click(screen.getByTestId('apple-playlist-import'))

    expect(onPick).toHaveBeenCalledWith('FFEEDDCCBBAA9988', 'Remember 90s')
  })

  it('cannot import before a playlist is chosen', async () => {
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    setup()
    await screen.findByText('Sesión sábado')

    expect(screen.getByTestId<HTMLButtonElement>('apple-playlist-import').disabled).toBe(true)
  })

  it('narrows the list as the user types, matching case-insensitively', async () => {
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    setup()
    await screen.findByText('Sesión sábado')

    fireEvent.change(screen.getByTestId('apple-playlist-search'), { target: { value: 'remember' } })

    expect(screen.queryByText('Sesión sábado')).toBeNull()
    expect(screen.getByText('Remember 90s')).toBeTruthy()
  })

  it('says so when the library has no playlists, instead of showing an empty box', async () => {
    loadAppleMusicPlaylists.mockResolvedValue([])
    setup()

    expect(await screen.findByTestId('apple-playlist-empty')).toBeTruthy()
  })

  it('offers an empty playlist but refuses to import it, since it would add nothing', async () => {
    // A playlist with no tracks is a real thing to see in the list — hiding it would look
    // like Surco lost it — but importing one is a no-op the user would read as a failure.
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    setup()

    fireEvent.click(await screen.findByText('Por clasificar'))

    expect(screen.getByTestId<HTMLButtonElement>('apple-playlist-import').disabled).toBe(true)
  })

  it('surfaces a failure to read the playlists rather than looking empty forever', async () => {
    loadAppleMusicPlaylists.mockRejectedValue(new Error('Music no responde'))
    setup()

    expect(await screen.findByTestId('apple-playlist-error')).toBeTruthy()
  })

  it('says it is working while the playlist is read, which takes seconds on a big one', async () => {
    // Measured against Music on macOS 26: a 982-track playlist takes 14.5s to read. The
    // dialog used to close on click and leave the window silent for all of it, which reads
    // as the app having ignored the click.
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    let release: () => void = () => {}
    const onPick = vi.fn(() => new Promise<void>((r) => (release = r)))
    render(<ApplePlaylistModal onPick={onPick} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByText('Remember 90s'))
    fireEvent.click(screen.getByTestId('apple-playlist-import'))

    expect(await screen.findByTestId('apple-playlist-reading')).toBeTruthy()
    // And it cannot be fired twice while that read is in flight.
    expect(screen.getByTestId<HTMLButtonElement>('apple-playlist-import').disabled).toBe(true)
    release()
  })

  it('closes without importing when the user cancels', async () => {
    loadAppleMusicPlaylists.mockResolvedValue(LISTS)
    const { onPick, onClose } = setup()
    await screen.findByText('Sesión sábado')

    fireEvent.click(screen.getByTestId('apple-playlist-cancel'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onPick).not.toHaveBeenCalled()
  })
})
