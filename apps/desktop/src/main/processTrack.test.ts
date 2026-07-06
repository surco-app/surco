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
    addToEngineDj: vi.fn(async () => {}),
    allowMedia: vi.fn(),
    existsSync: vi.fn(() => false),
    isSameFile: vi.fn(async () => false),
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
  it('rewrites the source, removes the renamed original and never prompts when the renamed target is free', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn(() => false),
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

  // The old exemption assumed an in-place target "always exists by definition" — only
  // true when the name doesn't change. A rename can land on an unrelated neighbour,
  // and the clobber then chains into removeRenamedOriginal deleting the source too,
  // so it must ride the same conflict prompt as a fresh conversion.
  it('prompts before an in-place rename lands on an existing unrelated file, and skip leaves everything untouched', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn(() => true),
      isSameFile: vi.fn(async () => false),
    })
    deps.confirmConflict = vi.fn(async () => 'skip' as const)
    const result = await runProcessTrack(job(), deps)

    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff')
    expect(deps.convertAudio).not.toHaveBeenCalled()
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(result.skipped).toBe(true)
  })

  // Rewriting a file under its own name (or a case-only rename the volume resolves to
  // one file) is the ordinary in-place edit — the "existing" target is the source
  // itself, never a collision.
  it('never prompts when the in-place target is the source file itself', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn(() => true),
      isSameFile: vi.fn(async () => true),
    })
    const result = await runProcessTrack(job(), deps)

    expect(deps.isSameFile).toHaveBeenCalledWith('/in/song.wav', '/in/Artist - Title.aiff')
    expect(deps.confirmConflict).not.toHaveBeenCalled()
    expect(deps.convertAudio).toHaveBeenCalledOnce()
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

describe('runProcessTrack — Engine DJ', () => {
  // The Engine DJ destination registers the written file (the path the library row
  // points at) after the conversion lands, and announces itself as its own stage so
  // the row shows what the wait is for. With no cover anywhere, the embedded-art
  // extraction from the written file simply yields nothing.
  it('registers the output file in the Engine library when the setting is on', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
    })
    const result = await runProcessTrack(job(), deps)

    expect(deps.addToEngineDj).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
    expect(deps.sendProgress).toHaveBeenCalledWith('engineDj')
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  // Engine only renders art stored in its own database, so the processed cover the
  // conversion embedded must also reach the library add.
  it('hands the prepared cover to the Engine library add', async () => {
    const deps = makeDeps({ settings: settings({ addToEngineDj: true }) })
    await runProcessTrack(job({ coverPath: '/art/cover.jpg' }), deps)

    expect(deps.addToEngineDj).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, '/tmp/cover.jpg')
    // The job's own cover preparation is the only one — no second extraction pass.
    expect(deps.prepareProcessedCover).toHaveBeenCalledTimes(1)
  })

  // A job with no cover source still usually has art embedded in the source file,
  // which the conversion carried into the output — pull it from there so the Engine
  // row isn't artless, and drop the temp image afterwards.
  it('extracts embedded art from the written file when the job prepared none', async () => {
    const cleanup = vi.fn(async () => {})
    const prepareProcessedCover = vi.fn(async () => ({ path: '/tmp/extracted.jpg', cleanup }))
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover,
    })
    await runProcessTrack(job(), deps)

    expect(prepareProcessedCover).toHaveBeenCalledWith(
      { coverFromFile: '/out/Artist - Title.aiff' },
      { maxSize: 1000, square: false },
    )
    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      '/tmp/extracted.jpg',
    )
    expect(cleanup).toHaveBeenCalled()
  })

  // Extraction failing (artless or odd file) must not block the library add itself.
  it('still registers the track when art extraction fails', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => {
        throw new Error('no picture stream')
      }),
    })
    await runProcessTrack(job(), deps)
    expect(deps.addToEngineDj).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
  })

  it('leaves the Engine library alone when the setting is off', async () => {
    const deps = makeDeps()
    await runProcessTrack(job(), deps)
    expect(deps.addToEngineDj).not.toHaveBeenCalled()
  })

  // A failed registration must fail the job loudly (like a failed Apple Music add) —
  // reporting success while the library was never touched would hide the miss.
  it('propagates a failed Engine library write', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      addToEngineDj: vi.fn(async () => {
        throw new Error('biblioteca abierta')
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow('biblioteca abierta')
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
