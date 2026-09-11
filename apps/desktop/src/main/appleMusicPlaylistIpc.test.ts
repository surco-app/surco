import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const dumpAppleMusicPlaylists = vi.fn()
const readAppleMusicPlaylist = vi.fn()
vi.mock('./appleMusicPlaylists', () => ({
  dumpAppleMusicPlaylists: (...a: unknown[]) => dumpAppleMusicPlaylists(...a),
  readAppleMusicPlaylist: (...a: unknown[]) => readAppleMusicPlaylist(...a),
}))

vi.mock('./applemusic', () => ({
  addToAppleMusic: vi.fn(),
  appleMusicLimiter: { run: (fn: () => unknown) => fn() },
  deleteFromAppleMusic: vi.fn(),
  dumpAppleMusicLibrary: vi.fn(),
  revealInAppleMusic: vi.fn(),
  updateInAppleMusic: vi.fn(),
}))
vi.mock('./activity', () => ({
  activity: { track: (_k: string, _l: string, fn: () => unknown) => fn() },
}))
vi.mock('./appleMusicLibraryCache', () => ({
  loadLibraryCache: vi.fn(),
  saveLibraryCache: vi.fn(),
}))
vi.mock('./cover', () => ({ hasCoverSource: () => false, prepareProcessedCover: vi.fn() }))
vi.mock('./i18n', () => ({ createMenuT: () => (k: string) => k }))
vi.mock('./settings', () => ({ getSettings: () => ({}) }))

const realPlatform = process.platform
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

async function register(): Promise<void> {
  handlers.clear()
  vi.resetModules()
  const { registerAppleMusicIpc } = await import('./appleMusicIpc')
  registerAppleMusicIpc()
}

beforeEach(() => {
  dumpAppleMusicPlaylists.mockReset()
  readAppleMusicPlaylist.mockReset()
  setPlatform('darwin')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
})

describe('applemusic:playlists', () => {
  it('returns the playlists on macOS', async () => {
    dumpAppleMusicPlaylists.mockResolvedValue([
      { name: 'Sesión sábado', count: 128, persistentId: 'A1B2C3D4E5F60718' },
    ])
    await register()
    const rows = await handlers.get('applemusic:playlists')?.({})
    expect(rows).toEqual([{ name: 'Sesión sábado', count: 128, persistentId: 'A1B2C3D4E5F60718' }])
  })

  it('returns nothing off macOS without spawning osascript, which does not exist there', async () => {
    // The renderer never offers the button off macOS, but a handler that shelled out
    // anyway would turn a stray call into a spawn failure instead of an empty list.
    setPlatform('win32')
    await register()
    const rows = await handlers.get('applemusic:playlists')?.({})
    expect(rows).toEqual([])
    expect(dumpAppleMusicPlaylists).not.toHaveBeenCalled()
  })
})

describe('applemusic:playlistTracks', () => {
  it('returns the paths and how many tracks had no file', async () => {
    readAppleMusicPlaylist.mockResolvedValue({ paths: ['/m/a.aiff'], missing: 6 })
    await register()
    const out = await handlers.get('applemusic:playlistTracks')?.({}, 'A1B2C3D4E5F60718')
    expect(out).toEqual({ paths: ['/m/a.aiff'], missing: 6 })
  })

  it('reads the playlist the renderer asked for, by persistent ID', async () => {
    readAppleMusicPlaylist.mockResolvedValue({ paths: [], missing: 0 })
    await register()
    await handlers.get('applemusic:playlistTracks')?.({}, 'FFEEDDCCBBAA9988')
    expect(readAppleMusicPlaylist).toHaveBeenCalledWith('FFEEDDCCBBAA9988')
  })

  it('returns an empty result off macOS instead of spawning osascript', async () => {
    setPlatform('win32')
    await register()
    const out = await handlers.get('applemusic:playlistTracks')?.({}, 'A1B2C3D4E5F60718')
    expect(out).toEqual({ paths: [], missing: 0 })
    expect(readAppleMusicPlaylist).not.toHaveBeenCalled()
  })
})
