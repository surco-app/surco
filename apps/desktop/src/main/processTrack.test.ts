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
    declick: 'off',
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
    appleMusicEntryLocation: vi.fn(async () => '/Users/me/Music/Media/f.aiff'),
    deleteAppleMusic: vi.fn(async () => {}),
    isPathReserved: vi.fn(() => false),
    reservePath: vi.fn(),
    releasePath: vi.fn(),
    registerActiveConversion: vi.fn(),
    unregisterActiveConversion: vi.fn(),
    trackTmp: vi.fn(),
    untrackTmp: vi.fn(),
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
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
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

  it('prefers the job’s click-repair override over the settings default', async () => {
    const deps = makeDeps({
      settings: settings({ declick: 'standard' }),
    })
    await runProcessTrack(job({ declick: 'strong' }), deps)
    const call = (deps.convertAudio as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[10]).toEqual('strong')
  })

  // Unlike declick, trim has no settings default — it only exists as the per-track
  // range the user confirmed in the editor, so it rides the job or not at all.
  it('threads the job’s silence trim through to the encoder', async () => {
    const deps = makeDeps()
    await runProcessTrack(job({ trim: { startSec: 1.5, endSec: 200 } }), deps)
    const call = (deps.convertAudio as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[11]).toEqual({ startSec: 1.5, endSec: 200 })
  })

  it('surfaces the repaired-sample count the encoder reported', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async () => ({ normalizeSkipped: false, declickedSamples: 42 })),
    })
    const result = await runProcessTrack(job(), deps)
    expect(result.declickedSamples).toBe(42)
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
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
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
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
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
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
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

  // A concurrent batch job resolved the same output name a moment ago and hasn't
  // finished writing it yet, so existsSync is still false — the reservation is the
  // only signal that a collision is coming.
  it('treats a path another in-flight job reserved as a conflict too', async () => {
    const deps = makeDeps({
      isPathReserved: vi.fn((p: string) => p === '/out/Artist - Title.aiff'),
    })
    deps.confirmConflict = vi.fn(async () => 'keepBoth' as const)
    const result = await runProcessTrack(job(), deps)

    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff')
    expect(result.outputPath).toBe('/out/Artist - Title (2).aiff')
  })

  it('releases the reservation once the job settles, success or failure', async () => {
    const deps = makeDeps()
    await runProcessTrack(job(), deps)
    expect(deps.reservePath).toHaveBeenCalledWith('/out/Artist - Title.aiff')
    expect(deps.releasePath).toHaveBeenCalledWith('/out/Artist - Title.aiff')

    const failing = makeDeps({
      convertAudio: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    await expect(runProcessTrack(job(), failing)).rejects.toThrow('disk full')
    expect(failing.reservePath).toHaveBeenCalledWith('/out/Artist - Title.aiff')
    expect(failing.releasePath).toHaveBeenCalledWith('/out/Artist - Title.aiff')
  })
})

describe('runProcessTrack — cancel reaches the running encode', () => {
  // The only way a cancel button can kill an already-started conversion: main
  // must know which child belongs to which job for exactly the window it runs.
  it('registers the child under the job id and unregisters it once the job settles, success or failure', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async (...args: unknown[]) => {
        const onChild = args[8] as (child: { kill: (s: string) => void }) => void
        onChild({ kill: vi.fn() })
        return { normalizeSkipped: false }
      }),
    })
    await runProcessTrack(job(), deps)

    expect(deps.registerActiveConversion).toHaveBeenCalledWith('job1', expect.any(Function))
    expect(deps.unregisterActiveConversion).toHaveBeenCalledWith('job1')
    // unregister must run after register, so a cancel firing exactly as the job
    // settles can't be left registered forever.
    const registerOrder = (deps.registerActiveConversion as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]
    const unregisterOrder = (deps.unregisterActiveConversion as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]
    expect(unregisterOrder).toBeGreaterThan(registerOrder)
  })

  it('still unregisters the job when the encode throws', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async () => {
        throw new Error('killed by signal SIGTERM')
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow('killed by signal')
    expect(deps.unregisterActiveConversion).toHaveBeenCalledWith('job1')
  })
})

describe('runProcessTrack — orphaned tmp trail', () => {
  // convertAudio's own catch already deletes the tmp on a normal failure, so
  // trackTmp/untrackTmp exist purely for the case that skips that catch entirely:
  // the whole app quitting or crashing mid-encode. The manifest is what the next
  // launch sweeps.
  it('tracks the tmp path the instant convertAudio picks it, untracking it once the job settles', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async (...args: unknown[]) => {
        const onTmp = args[9] as (path: string) => void
        onTmp('/out/Artist - Title.tmp-a1b2c3d4.aiff')
        return { normalizeSkipped: false }
      }),
    })
    await runProcessTrack(job(), deps)

    expect(deps.trackTmp).toHaveBeenCalledWith('/out/Artist - Title.tmp-a1b2c3d4.aiff')
    expect(deps.untrackTmp).toHaveBeenCalledWith('/out/Artist - Title.tmp-a1b2c3d4.aiff')
  })

  it('still untracks the tmp path when the encode throws', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async (...args: unknown[]) => {
        const onTmp = args[9] as (path: string) => void
        onTmp('/out/Artist - Title.tmp-a1b2c3d4.aiff')
        throw new Error('disk full')
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow('disk full')
    expect(deps.untrackTmp).toHaveBeenCalledWith('/out/Artist - Title.tmp-a1b2c3d4.aiff')
  })

  it('never untracks when convertAudio never got as far as picking a tmp path', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async () => {
        throw new Error('cover prep failed before any tmp existed')
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow()
    expect(deps.untrackTmp).not.toHaveBeenCalled()
  })
})

// The editor's explicit "Re-encode": same-format source, but the job carries
// forceReencode — it must route to the output folder like a real conversion
// (original untouched) and hand the flag to convertAudio so the copy shortcut
// is skipped and the pinned quality applies.
describe('runProcessTrack — forced re-encode', () => {
  it('writes a fresh output-folder file and passes the flag to the encoder', async () => {
    const deps = makeDeps()
    const result = await runProcessTrack(
      job({ inputPath: '/in/song.aiff', forceReencode: true }),
      deps,
    )

    expect(result.inPlace).toBe(false)
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.aiff',
      '/out/Artist - Title.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
      true,
      expect.any(Function),
      expect.any(Function),
      'off',
      undefined,
    )
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
  })
})

describe('runProcessTrack — beside the original', () => {
  // The mode's whole contract: a fresh file in the source's own folder and the
  // original never touched — no in-place rewrite, no unlink, no prompt.
  it('converts next to the source and leaves the original alone', async () => {
    const deps = makeDeps({ settings: settings({ convertBesideOriginal: true }) })
    const result = await runProcessTrack(job({ outputName: 'song' }), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/song.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
      undefined,
    )
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(deps.confirmConflict).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outputPath: '/in/song.aiff', inPlace: false })
  })

  // Same extension resolves to the source's own path — the copy takes a "(n)" name
  // silently (like keep-both), because prompting would defeat the mode's promise and
  // overwriting the source would break it.
  it('bumps a same-format copy to "(2)" instead of touching the source', async () => {
    const deps = makeDeps({
      settings: settings({ convertBesideOriginal: true }),
      existsSync: vi.fn((p: string) => p === '/in/song.wav'),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
    })
    const result = await runProcessTrack(job({ outputName: 'song', format: 'wav' }), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/song (2).wav',
      'wav',
      {},
      undefined,
      { mode: 'none' },
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
      undefined,
    )
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(deps.confirmConflict).not.toHaveBeenCalled()
    expect(result.outputPath).toBe('/in/song (2).wav')
  })

  // A re-export must not pile up "(3)", "(4)"… — the track's own previous copy is the
  // one file the mode may overwrite, so the second run lands back on "(2)".
  it('reuses its own previous copy on a re-export', async () => {
    const deps = makeDeps({
      settings: settings({ convertBesideOriginal: true }),
      existsSync: vi.fn((p: string) => p === '/in/song.wav' || p === '/in/song (2).wav'),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
    })
    const result = await runProcessTrack(
      job({ outputName: 'song', format: 'wav', previousOutputPath: '/in/song (2).wav' }),
      deps,
    )
    expect(result.outputPath).toBe('/in/song (2).wav')
    expect(deps.confirmConflict).not.toHaveBeenCalled()
  })

  // A stale previousOutputPath can point at the source itself (an in-place run before
  // the mode switch). The source is never a valid target here, whatever claims it.
  it('never writes over the source, even when the previous output was the source', async () => {
    const deps = makeDeps({
      settings: settings({ convertBesideOriginal: true }),
      existsSync: vi.fn((p: string) => p === '/in/song.wav'),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
    })
    const result = await runProcessTrack(
      job({ outputName: 'song', format: 'wav', previousOutputPath: '/in/song.wav' }),
      deps,
    )
    expect(result.outputPath).toBe('/in/song (2).wav')
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
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
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
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

describe('runProcessTrack — Apple Music only copy verification', () => {
  const musicOnly = () =>
    makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
    })

  // "Apple Music only" removes the temp conversion after the add — safe only when
  // Music COPIED the file into its Media folder. With that preference off the fresh
  // entry still references the temp path; deleting it would leave a library row that
  // plays nothing. The add must be rolled back and the job failed out loud instead.
  it('rolls back the add and fails when Music referenced the temp file instead of copying it', async () => {
    const deps = musicOnly()
    deps.appleMusicEntryLocation = vi.fn(async () => '/tmp/surco-abc/Artist - Title.aiff')
    await expect(runProcessTrack(job(), deps)).rejects.toThrow()
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('added-id')
    expect(deps.rm).toHaveBeenCalled()
  })

  it('cleans the temp and succeeds when Music copied the file into its own folder', async () => {
    const deps = musicOnly()
    deps.appleMusicEntryLocation = vi.fn(async () => '/Users/me/Music/Media/Artist - Title.aiff')
    const result = await runProcessTrack(job(), deps)
    expect(result.addedToMusicOnly).toBe(true)
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
  })
})

describe('runProcessTrack — pinned overwrite', () => {
  // The batch pins overwriteOriginal when it starts; the flag rides each job so a
  // Settings flip mid-run cannot turn the remaining queued tracks into unconfirmed
  // in-place rewrites of their sources.
  it('honors the job pin over the live setting', async () => {
    const deps = makeDeps({ settings: settings({ overwriteOriginal: true }) })
    const result = await runProcessTrack(job({ overwriteOriginal: false }), deps)

    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/out/Artist - Title.aiff',
      'aiff',
      {},
      undefined,
      { mode: 'none' },
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
      undefined,
    )
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(result.inPlace).toBe(false)
  })

  it('falls back to the live setting when the job carries no pin', async () => {
    const deps = makeDeps({ settings: settings({ overwriteOriginal: true }) })
    const result = await runProcessTrack(job(), deps)
    expect(result.inPlace).toBe(true)
  })
})

describe('runProcessTrack — per-job destination', () => {
  // The editor's split-button can send one conversion somewhere else without touching
  // Settings. Like the overwrite pin, each destination facet rides the job and falls
  // back to the live setting only when absent — otherwise a one-shot "this track to
  // Engine DJ" would still convert to wherever Settings points.
  it('honors a job that opts out of the configured Engine DJ registration', async () => {
    const deps = makeDeps({ settings: settings({ addToEngineDj: true }) })
    await runProcessTrack(job({ addToEngineDj: false }), deps)
    expect(deps.addToEngineDj).not.toHaveBeenCalled()
  })

  it('registers in Engine DJ when only the job asks for it', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: false }),
      prepareProcessedCover: vi.fn(async () => undefined),
    })
    await runProcessTrack(job({ addToEngineDj: true }), deps)
    expect(deps.addToEngineDj).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
  })

  it('adds to Apple Music when only the job asks for it', async () => {
    const deps = makeDeps({ platform: 'darwin', settings: settings({ addToAppleMusic: false }) })
    await runProcessTrack(job({ addToAppleMusic: true }), deps)
    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
  })

  it('skips the configured Apple Music add when the job opts out', async () => {
    const deps = makeDeps({ platform: 'darwin', settings: settings({ addToAppleMusic: true }) })
    await runProcessTrack(job({ addToAppleMusic: false }), deps)
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
  })

  it('converts beside the original when only the job asks for it', async () => {
    const deps = makeDeps({ settings: settings({ convertBesideOriginal: false }) })
    const result = await runProcessTrack(
      job({ outputName: 'song', convertBesideOriginal: true }),
      deps,
    )
    expect(result.outputPath).toBe('/in/song.aiff')
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
  })

  it('runs "Apple Music only" when the job asks for the add without the output copy', async () => {
    const deps = makeDeps({ platform: 'darwin', settings: settings() })
    const result = await runProcessTrack(
      job({ addToAppleMusic: true, keepOutputCopy: false }),
      deps,
    )
    expect(result.addedToMusicOnly).toBe(true)
    expect(result.outputPath).toBe('')
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
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
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
