import { describe, expect, it, vi } from 'vitest'
import type { ProcessJob, Settings, TrackMetadata } from '../shared/types'
import { type ProcessTrackDeps, runProcessTrack } from './processTrack'

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    coverMaxSize: 1000,
    coverSquare: false,
    outputFormat: 'aiff',
    outputDir: '/out',
    overwriteOriginal: false,
    addToAppleMusic: false,
    keepOutputCopy: true,
    normalize: { mode: 'none' },
    ...overrides,
  } as Settings
}

function job(overrides: Partial<ProcessJob> = {}): ProcessJob {
  return {
    id: 'job1',
    inputPath: '/in/song.wav',
    outputName: 'Artist - Title',
    meta: {} as TrackMetadata,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ProcessTrackDeps> = {}): ProcessTrackDeps {
  return {
    settings: settings(),
    platform: 'linux',
    sendProgress: vi.fn(),
    hasCoverSource: vi.fn(() => false),
    prepareProcessedCover: vi.fn(async () => ({
      path: '/tmp/cover.jpg',
      cleanup: vi.fn(async () => {}),
    })),
    convertAudio: vi.fn(async () => ({ normalizeSkipped: false })),
    recordConversion: vi.fn(),
    removeRenamedOriginal: vi.fn(async () => {}),
    addToAppleMusic: vi.fn(async () => 'added-id'),
    updateInAppleMusic: vi.fn(async () => 'updated-id'),
    allowMedia: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdir: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async () => '/tmp/surco-abc'),
    rm: vi.fn(async () => {}),
    confirmConflict: vi.fn(async () => 'overwrite' as const),
    ...overrides,
  }
}

// These pin the conversion orchestration that lived inline in the process:track IPC
// handler and had no main-side test before it was lifted into runProcessTrack. They
// guard each branch — cover, output target, conflict resolution, Apple Music sync and
// the return shapes the renderer reads — so a later refactor of the workflow can't
// silently change what gets written, recorded, imported or reported.
describe('runProcessTrack — plain conversion', () => {
  it('converts to the output folder, records it and lets the file stream back', async () => {
    const deps = makeDeps()
    const result = await runProcessTrack(job(), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/out/Artist - Title.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
    )
    expect(deps.mkdir).toHaveBeenCalledWith('/out', { recursive: true })
    expect(deps.recordConversion).toHaveBeenCalledOnce()
    expect(deps.allowMedia).toHaveBeenCalledWith('/out/Artist - Title.aiff')
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(result).toEqual({
      outputPath: '/out/Artist - Title.aiff',
      inPlace: false,
      musicPersistentId: undefined,
      normalizeSkipped: false,
    })
  })

  it('skips the cover stage when the job names no artwork', async () => {
    const deps = makeDeps({ hasCoverSource: vi.fn(() => false) })
    await runProcessTrack(job(), deps)

    expect(deps.prepareProcessedCover).not.toHaveBeenCalled()
    const stages = (deps.sendProgress as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(stages).toEqual(['converting'])
  })

  it('surfaces a failed loudness pass through normalizeSkipped', async () => {
    const deps = makeDeps({ convertAudio: vi.fn(async () => ({ normalizeSkipped: true })) })
    const result = await runProcessTrack(job(), deps)
    expect(result.normalizeSkipped).toBe(true)
  })
})

describe('runProcessTrack — cover handling', () => {
  it('prepares the cover, passes its path to the encoder and cleans it up', async () => {
    const cleanup = vi.fn(async () => {})
    const deps = makeDeps({
      hasCoverSource: vi.fn(() => true),
      prepareProcessedCover: vi.fn(async () => ({ path: '/tmp/cover.jpg', cleanup })),
    })
    await runProcessTrack(job(), deps)

    expect(deps.prepareProcessedCover).toHaveBeenCalledWith(expect.anything(), {
      maxSize: 1000,
      square: false,
    })
    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/out/Artist - Title.aiff',
      'aiff',
      {},
      '/tmp/cover.jpg',
      { mode: 'none' },
      undefined,
    )
    const stages = (deps.sendProgress as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(stages).toEqual(['cover', 'converting'])
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('still cleans up the prepared cover when the encode throws', async () => {
    const cleanup = vi.fn(async () => {})
    const deps = makeDeps({
      hasCoverSource: vi.fn(() => true),
      prepareProcessedCover: vi.fn(async () => ({ path: '/tmp/cover.jpg', cleanup })),
      convertAudio: vi.fn(async () => {
        throw new Error('ffmpeg failed')
      }),
    })

    await expect(runProcessTrack(job(), deps)).rejects.toThrow('ffmpeg failed')
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe('runProcessTrack — output conflict', () => {
  const conflicting = () => makeDeps({ existsSync: vi.fn((p) => p === '/out/Artist - Title.aiff') })

  it('writes nothing and reports skipped when the user skips', async () => {
    const deps = conflicting()
    deps.confirmConflict = vi.fn(async () => 'skip' as const)
    const result = await runProcessTrack(job(), deps)

    expect(result).toEqual({ outputPath: '', inPlace: false, skipped: true })
    expect(deps.convertAudio).not.toHaveBeenCalled()
    expect(deps.recordConversion).not.toHaveBeenCalled()
  })

  it('writes to a free "(2)" name when the user keeps both', async () => {
    const deps = conflicting()
    deps.confirmConflict = vi.fn(async () => 'keepBoth' as const)
    const result = await runProcessTrack(job(), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/out/Artist - Title (2).aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
    )
    expect(result.outputPath).toBe('/out/Artist - Title (2).aiff')
  })

  it('writes over the existing file when the user overwrites', async () => {
    const deps = conflicting()
    deps.confirmConflict = vi.fn(async () => 'overwrite' as const)
    const result = await runProcessTrack(job(), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/out/Artist - Title.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
    )
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  it('never prompts when the colliding file is the track’s own previous output', async () => {
    const deps = conflicting()
    await runProcessTrack(job({ previousOutputPath: '/out/Artist - Title.aiff' }), deps)
    expect(deps.confirmConflict).not.toHaveBeenCalled()
    expect(deps.convertAudio).toHaveBeenCalledOnce()
  })
})

describe('runProcessTrack — in-place rewrite', () => {
  it('rewrites the source, removes the renamed original and never prompts', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn(() => true),
    })
    const result = await runProcessTrack(job(), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/Artist - Title.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
    )
    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/Artist - Title.aiff',
    )
    expect(deps.confirmConflict).not.toHaveBeenCalled()
    expect(result.inPlace).toBe(true)
  })
})

describe('runProcessTrack — Apple Music', () => {
  const mac = (over: Partial<Settings> = {}) =>
    makeDeps({ platform: 'darwin', settings: settings({ addToAppleMusic: true, ...over }) })

  it('adds a fresh track and returns the new persistent id', async () => {
    const deps = mac()
    const result = await runProcessTrack(job(), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
    expect(result.musicPersistentId).toBe('added-id')
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  it('updates the existing library copy instead of importing again', async () => {
    const deps = mac()
    const result = await runProcessTrack(job({ musicPersistentId: 'lib-7' }), deps)

    expect(deps.updateInAppleMusic).toHaveBeenCalledWith('lib-7', {}, undefined)
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(result.musicPersistentId).toBe('updated-id')
  })

  it('re-imports when the library copy is gone (update returns null)', async () => {
    const deps = mac()
    deps.updateInAppleMusic = vi.fn(async () => null)
    const result = await runProcessTrack(job({ musicPersistentId: 'lib-7' }), deps)

    expect(deps.updateInAppleMusic).toHaveBeenCalledOnce()
    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
    expect(result.musicPersistentId).toBe('added-id')
  })

  it('does not touch Apple Music for a FLAC export even on macOS', async () => {
    const deps = mac({ outputFormat: 'flac' })
    await runProcessTrack(job(), deps)
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
  })
})

describe('runProcessTrack — Apple Music only', () => {
  const musicOnly = () =>
    makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
    })

  it('converts into a temp dir, imports it, removes the temp and reports music-only', async () => {
    const deps = musicOnly()
    const result = await runProcessTrack(job(), deps)

    expect(deps.mkdtemp).toHaveBeenCalledOnce()
    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/tmp/surco-abc/Artist - Title.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
    )
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      '/tmp/surco-abc/Artist - Title.aiff',
      {},
      undefined,
    )
    expect(deps.rm).toHaveBeenCalledWith('/tmp/surco-abc', { recursive: true, force: true })
    expect(deps.allowMedia).not.toHaveBeenCalled()
    expect(result).toEqual({
      outputPath: '',
      inPlace: false,
      addedToMusicOnly: true,
      musicPersistentId: 'added-id',
      normalizeSkipped: false,
    })
  })

  it('removes the temp dir even when the Apple Music add throws', async () => {
    const deps = musicOnly()
    deps.addToAppleMusic = vi.fn(async () => {
      throw new Error('Music unavailable')
    })

    await expect(runProcessTrack(job(), deps)).rejects.toThrow('Music unavailable')
    expect(deps.rm).toHaveBeenCalledWith('/tmp/surco-abc', { recursive: true, force: true })
  })
})
