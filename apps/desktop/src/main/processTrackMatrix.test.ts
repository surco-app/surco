import { describe, expect, it, vi } from 'vitest'
import type { ProcessJob, Settings, TrackMetadata } from '../shared/types'
import { type ProcessTrackDeps, runProcessTrack } from './processTrack'

// Fixture helpers mirror processTrack.test.ts exactly, so this file reads like a direct
// continuation of it rather than a parallel convention.
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

// This file covers the format x destination x filter cells the audit flagged as
// uncovered: in-place export combined with Apple Music/Engine DJ, the overwrite
// destination end-to-end, overwrite with ALAC, and beside-the-original under a filter.
// Same-format-no-filter beside cases already live in processTrack.test.ts (lines
// 415-506) and are not repeated here.

describe('runProcessTrack — in-place x Apple Music', () => {
  // The critical invariant of the whole matrix: when the export rewrites the source
  // in place (same format, no destination change) and the user also wants the track
  // in Apple Music, Surco must import the FILE ITSELF — never a tmpdir copy. isAppleMusicOnly
  // is gated by `!inPlace` specifically so this never becomes "Apple Music only" (which
  // would write to a private tmpDir and rm it in the finally): that path is only for a
  // fresh conversion the user doesn't want a folder copy of. Rewriting the user's own
  // source and THEN silently deleting it because it looks like a disposable tmp copy
  // would destroy the only copy of their file.
  it('imports the in-place target itself, never a tmpdir copy, and never deletes the source file', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({
        outputFormat: 'aiff',
        overwriteOriginal: false,
        addToAppleMusic: true,
        keepOutputCopy: false,
      }),
      existsSync: vi.fn(() => false),
    })
    const result = await runProcessTrack(job({ inputPath: '/in/song.aiff', format: 'aiff' }), deps)

    // Same format as input -> resolveOutputTarget resolves in place, so isAppleMusicOnly's
    // `!inPlace` guard must have kept musicOnly false.
    expect(deps.mkdtemp).not.toHaveBeenCalled()
    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.aiff',
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
      undefined,
      undefined,
    )
    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/in/Artist - Title.aiff', {}, undefined)
    expect(result.addedToMusicOnly).toBeUndefined()
    expect(result.outputPath).toBe('/in/Artist - Title.aiff')
    expect(result.inPlace).toBe(true)
    // rm is only ever called on tmpDir (musicOnly path); it must never fire here since
    // there is no tmpDir and the source is the file the user keeps.
    expect(deps.rm).not.toHaveBeenCalled()
  })
})

describe('runProcessTrack — in-place x Engine DJ', () => {
  // Engine DJ's library row must point at wherever the file actually ends up — for an
  // in-place export that is the ORIGINAL's own folder (the renamed/rewritten source),
  // never settings.outputDir, since no folder copy is written at all in this mode.
  it('registers the in-place target, in the original folder, not outputDir', async () => {
    const deps = makeDeps({
      settings: settings({ outputFormat: 'aiff', addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
    })
    await runProcessTrack(job({ inputPath: '/in/song.aiff', format: 'aiff' }), deps)

    expect(deps.addToEngineDj).toHaveBeenCalledWith('/in/Artist - Title.aiff', {}, undefined)
  })
})

describe('runProcessTrack — overwrite end-to-end', () => {
  it('removes the original after converting to a different format under overwrite', async () => {
    const deps = makeDeps({
      settings: settings({ outputFormat: 'aiff', overwriteOriginal: true }),
    })
    const result = await runProcessTrack(job({ inputPath: '/in/song.wav', format: 'mp3' }), deps)

    expect(result.inPlace).toBe(true)
    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/Artist - Title.mp3',
    )
  })

  // 'source' resolved to the same format the file already has: the in-place target is
  // literally the input path (no rename happened), so isSameFile reports true and
  // removeRenamedOriginal (called unconditionally when inPlace) finds input === output
  // and no-ops — no unlink of the file it just wrote.
  it('does not unlink the target when the overwrite in-place target is the same file as the input', async () => {
    const deps = makeDeps({
      settings: settings({ outputFormat: 'wav', overwriteOriginal: true }),
      removeRenamedOriginal: vi.fn(async (input: string, output: string) => {
        // Mirrors the real removeRenamedOriginal contract: input === output is a no-op,
        // never an unlink.
        expect(input).toBe(output)
      }),
    })
    const result = await runProcessTrack(
      job({ inputPath: '/in/Artist - Title.wav', outputName: 'Artist - Title', format: 'wav' }),
      deps,
    )

    expect(result.outputPath).toBe('/in/Artist - Title.wav')
    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith(
      '/in/Artist - Title.wav',
      '/in/Artist - Title.wav',
    )
  })
})

describe('runProcessTrack — overwrite x ALAC', () => {
  // ALAC's never-in-place invariant holds even under overwrite (see editsInPlace):
  // the .m4a source it would replace may hold lossy AAC, so overwrite must still land
  // in outputDir, leave the original .m4a untouched, and never call removeRenamedOriginal
  // (that helper only runs when inPlace is true).
  it('writes to outputDir, leaves the original untouched and never calls removeRenamedOriginal', async () => {
    const deps = makeDeps({
      settings: settings({ outputFormat: 'alac', overwriteOriginal: true, outputDir: '/out' }),
    })
    const result = await runProcessTrack(job({ inputPath: '/in/song.m4a', format: 'alac' }), deps)

    expect(result.inPlace).toBe(false)
    expect(result.outputPath).toBe('/out/Artist - Title.m4a')
    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.m4a',
      '/out/Artist - Title.m4a',
      'alac',
      {},
      undefined,
      { mode: 'none' },
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
      undefined,
      undefined,
      undefined,
    )
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
  })
})

describe('runProcessTrack — beside the original x filters', () => {
  // Beside mode's contract (never in-place, target always in dirname(input)) must hold
  // even when a filter forces a real re-encode instead of the plain-copy case
  // processTrack.test.ts already covers.
  it('stays out of place and targets dirname(input) when normalize is active', async () => {
    const deps = makeDeps({
      settings: settings({ convertBesideOriginal: true, outputFormat: 'aiff' }),
    })
    const normalize = { mode: 'peak' as const, targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    const result = await runProcessTrack(
      job({ inputPath: '/in/song.wav', outputName: 'song', normalize }),
      deps,
    )

    expect(result.inPlace).toBe(false)
    expect(result.outputPath).toBe('/in/song.aiff')
    expect(deps.convertAudio).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/song.aiff',
      'aiff',
      {},
      undefined,
      normalize,
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      'off',
      undefined,
      undefined,
      undefined,
    )
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
  })
})
