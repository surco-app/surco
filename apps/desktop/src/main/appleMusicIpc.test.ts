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

const addToAppleMusic = vi.fn()
vi.mock('./applemusic', () => ({
  addToAppleMusic: (...args: unknown[]) => addToAppleMusic(...args),
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
