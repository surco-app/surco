import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The handlers are registered against a stub ipcMain so each test can invoke one directly
// with the job the renderer would have sent, without an Electron runtime.
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

const logError = vi.fn()
vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), error: (...args: unknown[]) => logError(...args), debug: vi.fn() },
}))

const trashRecoverably = vi.fn()
vi.mock('./recoverableTrash', () => ({
  trashRecoverably: (...args: unknown[]) => trashRecoverably(...args),
}))

const addToAppleMusic = vi.fn()
const deleteFromAppleMusic = vi.fn()
const setAppleMusicField = vi.fn()
vi.mock('./applemusic', () => ({
  addToAppleMusic: (...args: unknown[]) => addToAppleMusic(...args),
  appleMusicLimiter: { run: (fn: () => unknown) => fn() },
  deleteFromAppleMusic: (...args: unknown[]) => deleteFromAppleMusic(...args),
  dumpAppleMusicLibrary: vi.fn(),
  revealInAppleMusic: vi.fn(),
  setAppleMusicField: (...args: unknown[]) => setAppleMusicField(...args),
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

const readMeta = vi.fn()
vi.mock('./ffmpeg', () => ({ readMeta: (...args: unknown[]) => readMeta(...args) }))
const fetchAppleMusicArtwork = vi.fn()
vi.mock('./appleMusicArtwork', () => ({
  artworkDir: async () => '/tmp/art',
  fetchAppleMusicArtwork: (...args: unknown[]) => fetchAppleMusicArtwork(...args),
}))
const readAppleMusicPlaylist = vi.fn()
const dumpAppleMusicPlaylists = vi.fn()
vi.mock('./appleMusicPlaylists', () => ({
  dumpAppleMusicPlaylists: (...args: unknown[]) => dumpAppleMusicPlaylists(...args),
  readAppleMusicEntry: vi.fn(),
  readAppleMusicPlaylist: (...args: unknown[]) => readAppleMusicPlaylist(...args),
}))

const JOB = {
  outputPath: '/music/Castion - El Consentido.aiff',
  meta: { title: 'El Consentido', artist: 'Castion' },
}

describe('applemusic:add logging', () => {
  beforeEach(async () => {
    handlers.clear()
    logError.mockClear()
    addToAppleMusic.mockReset()
    const { registerAppleMusicIpc } = await import('./appleMusicIpc')
    registerAppleMusicIpc()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A failed send left nothing behind: the log only ever recorded update checks, so a user
  // reporting "it said something about an index" had no trace to send and neither did we.
  // AppleScript's own wording is the one line that identifies which step of the bridge
  // broke, so it has to survive into the log even though the renderer shows it too.
  it('records the failure, the file and the AppleScript message', async () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    addToAppleMusic.mockRejectedValue(
      new Error('Argument out of range: index must be less than -1'),
    )

    await expect(handlers.get('applemusic:add')?.(null, JOB)).rejects.toThrow('index must be less')

    expect(logError).toHaveBeenCalled()
    const logged = logError.mock.calls.flat().join(' ')
    // Without the path, a log from a 40-track batch names no culprit.
    expect(logged).toContain('/music/Castion - El Consentido.aiff')
    expect(logged).toContain('index must be less than -1')

    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  })

  it('stays quiet when the add succeeds', async () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    addToAppleMusic.mockResolvedValue('ABC123')

    await handlers.get('applemusic:add')?.(null, JOB)

    expect(logError).not.toHaveBeenCalled()

    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  })
})

describe('applemusic:delete', () => {
  const original = process.platform

  beforeEach(async () => {
    handlers.clear()
    trashRecoverably.mockReset()
    deleteFromAppleMusic.mockReset()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    const { registerAppleMusicIpc } = await import('./appleMusicIpc')
    registerAppleMusicIpc()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  })

  const run = () => handlers.get('applemusic:delete')?.(null, 'PID', 'Castion - El Consentido')

  it('trashes the removed copy through the recoverable trash so a NAS never deletes it outright', async () => {
    deleteFromAppleMusic.mockResolvedValue('/Volumes/Public/a.aiff')
    trashRecoverably.mockResolvedValue(undefined)
    expect(await run()).toEqual({ outcome: 'deleted', location: '/Volumes/Public/a.aiff' })
    expect(trashRecoverably).toHaveBeenCalledWith('/Volumes/Public/a.aiff')
  })

  it('reports deleted without a location when the file could not be trashed, so no row is marked trashed', async () => {
    deleteFromAppleMusic.mockResolvedValue('/Volumes/Public/a.aiff')
    trashRecoverably.mockRejectedValue(new Error('No recoverable trash'))
    expect(await run()).toEqual({ outcome: 'deleted', location: undefined })
  })
})

// A list undo puts a field back on the entry it wrote, and only while that entry still
// points at the same file: the guard apply used.
describe('applemusic:setField', () => {
  const original = process.platform

  beforeEach(async () => {
    handlers.clear()
    setAppleMusicField.mockReset().mockResolvedValue('set')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    const { registerAppleMusicIpc } = await import('./appleMusicIpc')
    registerAppleMusicIpc()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  })

  it('passes the file the entry must still point at to the Music write', async () => {
    const set = handlers.get('applemusic:setField')
    await set?.(null, 'PID', 'artist', 'DJ Lara', 'Dj Lara', '/m/c.aiff')
    expect(setAppleMusicField).toHaveBeenCalledWith(
      'PID',
      'artist',
      'DJ Lara',
      'Dj Lara',
      '/m/c.aiff',
    )
  })
})

describe('applemusic:playlistTracks', () => {
  beforeEach(async () => {
    handlers.clear()
    readMeta.mockReset()
    fetchAppleMusicArtwork.mockReset()
    readAppleMusicPlaylist.mockReset()
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { registerAppleMusicIpc } = await import('./appleMusicIpc')
    registerAppleMusicIpc()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Reading every file of a 406-track playlist on a NAS, then asking Music for the covers
  // they lacked, kept the list empty for over a minute; the rows come from Music alone.
  it('answers with Music’s rows without reading a file or fetching a cover first', async () => {
    const tracks = {
      paths: ['/m/a.wav', '/m/b.wav'],
      persistentIds: { '/m/a.wav': 'PA', '/m/b.wav': 'PB' },
      meta: {},
      missing: 0,
    }
    readAppleMusicPlaylist.mockResolvedValue(tracks)
    const out = await handlers.get('applemusic:playlistTracks')?.({}, 'P1')
    expect(out).toEqual(tracks)
    expect(readMeta).not.toHaveBeenCalled()
    expect(fetchAppleMusicArtwork).not.toHaveBeenCalled()
  })
})

describe('applemusic:artwork', () => {
  beforeEach(async () => {
    handlers.clear()
    fetchAppleMusicArtwork.mockReset()
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { registerAppleMusicIpc } = await import('./appleMusicIpc')
    registerAppleMusicIpc()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands back the covers Music held, by entry, and nothing for one without', async () => {
    fetchAppleMusicArtwork.mockResolvedValue([{ path: '/tmp/art/PB.jpg', url: 'thumb://pb' }])
    const out = await handlers.get('applemusic:artwork')?.({}, ['PA', 'PB'])
    expect(fetchAppleMusicArtwork).toHaveBeenCalledWith([
      { persistentId: 'PA', outPath: '/tmp/art/PA.jpg' },
      { persistentId: 'PB', outPath: '/tmp/art/PB.jpg' },
    ])
    expect(out).toEqual({ PB: { coverPath: '/tmp/art/PB.jpg', coverUrl: 'thumb://pb' } })
  })
})

describe('reading Apple Music', () => {
  const deferred = <T>() => {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }
  const empty = { paths: [], persistentIds: {}, meta: {}, missing: 0 }
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const invoke = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)?.({}, ...args) as Promise<unknown>

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    readAppleMusicPlaylist.mockReset()
    dumpAppleMusicPlaylists.mockReset()
    fetchAppleMusicArtwork.mockReset()
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    const { registerAppleMusicIpc } = await import('./appleMusicIpc')
    registerAppleMusicIpc()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Music answers one AppleEvent at a time; fifteen sent together queued inside Music until
  // all of them timed out, and no playlist opened at all.
  it('sends Music one read at a time', async () => {
    const first = deferred<typeof empty>()
    readAppleMusicPlaylist.mockReturnValueOnce(first.promise).mockResolvedValue(empty)
    const a = invoke('applemusic:playlistTracks', 'A')
    await settle()
    const b = invoke('applemusic:playlistTracks', 'B')
    await settle()
    expect(readAppleMusicPlaylist).toHaveBeenCalledTimes(1)
    first.resolve(empty)
    await a
    await b
    expect(readAppleMusicPlaylist).toHaveBeenLastCalledWith('B', undefined, undefined)
  })

  it('drops a playlist still waiting its turn once another is opened, since nobody is looking at it', async () => {
    const first = deferred<typeof empty>()
    readAppleMusicPlaylist.mockReturnValueOnce(first.promise).mockResolvedValue(empty)
    const a = invoke('applemusic:playlistTracks', 'A')
    await settle()
    const b = invoke('applemusic:playlistTracks', 'B')
    await settle()
    const c = invoke('applemusic:playlistTracks', 'C')
    await expect(b).rejects.toThrow()
    first.resolve(empty)
    await a
    await c
    expect(readAppleMusicPlaylist.mock.calls.map(([id]) => id)).toEqual(['A', 'C'])
  })

  it('shares one listing of the playlists among the asks made while it runs', async () => {
    const listing = deferred<unknown[]>()
    dumpAppleMusicPlaylists.mockReturnValue(listing.promise)
    const a = invoke('applemusic:playlists')
    const b = invoke('applemusic:playlists')
    listing.resolve([{ persistentId: 'p1', name: 'Friday', count: 1 }])
    expect(await a).toEqual(await b)
    expect(dumpAppleMusicPlaylists).toHaveBeenCalledTimes(1)
  })

  it('opens a playlist ahead of the covers still waiting', async () => {
    const first = deferred<typeof empty>()
    readAppleMusicPlaylist.mockReturnValueOnce(first.promise).mockResolvedValue(empty)
    fetchAppleMusicArtwork.mockResolvedValue([])
    const order: string[] = []
    const a = invoke('applemusic:playlistTracks', 'A')
    await settle()
    const covers = invoke('applemusic:artwork', ['PX']).then(() => order.push('covers'))
    await settle()
    const b = invoke('applemusic:playlistTracks', 'B').then(() => order.push('B'))
    await settle()
    first.resolve(empty)
    await Promise.all([a, covers, b])
    expect(order).toEqual(['B', 'covers'])
  })
})
