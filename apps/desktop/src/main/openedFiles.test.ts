import { describe, expect, it, vi } from 'vitest'
import { filesFromArgv, routeOpenedFile } from './openedFiles'

const deps = (over: Partial<Parameters<typeof routeOpenedFile>[1]> = {}) => ({
  window: () => null,
  ready: () => true,
  createWindow: vi.fn(),
  send: vi.fn(),
  pending: [] as string[],
  ...over,
})

describe('routeOpenedFile', () => {
  it('opens a window for a file opened from Finder while none is open', () => {
    const d = deps()
    routeOpenedFile('/m/a.wav', d)
    expect(d.pending).toEqual(['/m/a.wav'])
    expect(d.createWindow).toHaveBeenCalled()
  })

  it('only buffers before the app is ready, since the launch itself creates the window', () => {
    const d = deps({ ready: () => false })
    routeOpenedFile('/m/a.wav', d)
    expect(d.pending).toEqual(['/m/a.wav'])
    expect(d.createWindow).not.toHaveBeenCalled()
  })

  it('buffers for a window still loading, whose list drains the buffer once it mounts', () => {
    const d = deps({ window: () => ({ loading: true }) })
    routeOpenedFile('/m/a.wav', d)
    expect(d.pending).toEqual(['/m/a.wav'])
    expect(d.send).not.toHaveBeenCalled()
  })

  it('hands the file straight to a window that is up', () => {
    const d = deps({ window: () => ({ loading: false }) })
    routeOpenedFile('/m/a.wav', d)
    expect(d.send).toHaveBeenCalledWith(['/m/a.wav'])
    expect(d.pending).toEqual([])
  })
})

// Windows hands "Open with Surco" over as argv, never as open-file: on a cold launch in
// process.argv, and to the running instance through second-instance. Ignoring it left the
// file association registered but doing nothing beyond starting or focusing the app.
describe('filesFromArgv', () => {
  const exists = (path: string) => path !== 'C:\\Music\\gone.mp3'

  it('takes the audio files after the executable', () => {
    expect(
      filesFromArgv(['C:\\Surco\\Surco.exe', 'C:\\Music\\a.flac', 'D:\\Set\\b.MP3'], exists),
    ).toEqual(['C:\\Music\\a.flac', 'D:\\Set\\b.MP3'])
  })

  // Chromium appends its own switches to the second instance's argv, and the dev launch
  // passes the app folder: none of those is a file the user opened.
  it('skips switches, the app path and anything Surco cannot open', () => {
    expect(
      filesFromArgv(
        [
          'C:\\electron.exe',
          '.',
          '--allow-file-access-from-files',
          '--original-process-start-time=1',
          'C:\\Music\\notes.txt',
          'C:\\Music\\a.wav',
        ],
        exists,
      ),
    ).toEqual(['C:\\Music\\a.wav'])
  })

  // The path becomes streamable through surco://, so only a file that is really there
  // is let through.
  it('drops a path that does not exist', () => {
    expect(filesFromArgv(['Surco.exe', 'C:\\Music\\gone.mp3'], exists)).toEqual([])
  })

  it('never mistakes the executable itself for a file', () => {
    expect(filesFromArgv(['C:\\Music\\odd.mp3'], () => true)).toEqual([])
  })
})
