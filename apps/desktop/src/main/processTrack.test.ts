import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main'
import { describe, expect, it, vi } from 'vitest'
import { errorKeyOf, errorWithKey, splitNameLeftMarked } from '../shared/errorKeys'
import type { ProcessJob, Settings, TrackMetadata, TrashEntry } from '../shared/types'
import type { PlaceCheck } from '../shared/verification'
import { createActiveConversions } from './activeConversions'
import type { ConversionWritten } from './ffmpeg'
import { configureBackupDiscarder, configureOriginalKeeper, policyKeeper } from './originalKeeper'
import { createOutputReservations } from './outputReservations'
import { type ProcessTrackDeps, replaceAppleMusicCopy, runProcessTrack } from './processTrack'

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
    declick: { mode: 'off', noise: 'off' },
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

const written: ConversionWritten = {
  samplesKept: false,
  originalKept: false,
  plan: { ext: '.aiff', codec: 'pcm_s16be', bitDepth: 16 },
  sourceDurationSec: 2,
  trimmedSec: 0,
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
    convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async () => ({
      normalizeSkipped: false,
      written,
    })),
    recordConversion: vi.fn(),
    removeRenamedOriginal: vi.fn(async () => {}),
    addToAppleMusic: vi.fn(async () => 'added-id'),
    updateInAppleMusic: vi.fn(async () => 'updated-id'),
    addToEngineDj: vi.fn(async () => {}),
    allowMedia: vi.fn(),
    existsSync: vi.fn(() => false),
    isSameFile: vi.fn(async () => false),
    fileIdentity: vi.fn(async () => 'dev:1'),
    mkdir: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async () => '/tmp/surco-abc'),
    rm: vi.fn(async () => {}),
    rmdir: vi.fn(async () => {}),
    confirmConflict: vi.fn(async () => 'overwrite' as const),
    appleMusicEntryLocation: vi.fn(async () => '/Users/me/Music/Media/f.aiff'),
    appleMusicEntry: vi.fn(async () => ({
      path: '/Users/me/Music/Media/f.aiff',
      label: 'Artist - Title',
    })),
    deleteAppleMusic: vi.fn(async () => {}),
    carryAppleMusicHistory: vi.fn(async () => 'carried' as const),
    markAppleMusicReplacing: vi.fn(async () => 'set' as const),
    appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async () => []),
    isPathReserved: vi.fn(() => false),
    reservePath: vi.fn(),
    releasePath: vi.fn(),
    registerActiveConversion: vi.fn(),
    unregisterActiveConversion: vi.fn(),
    beginJob: vi.fn(),
    endJob: vi.fn(),
    trackTmp: vi.fn(),
    untrackTmp: vi.fn(),
    verifyFile: vi.fn<ProcessTrackDeps['verifyFile']>(async () => fileOk),
    verifyMusic: vi.fn<ProcessTrackDeps['verifyMusic']>(async () => musicOkDefault),
    ...overrides,
  }
}

const musicOkDefault: PlaceCheck = {
  place: 'appleMusic',
  state: 'ok',
  detail: { key: 'musicOneNoPlaylists' },
}

const fileOk: PlaceCheck = {
  place: 'file',
  state: 'ok',
  detail: { key: 'fileReencoded', params: { format: 'AIFF', rate: 44100, bits: 16 } },
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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
      outputIdentity: 'dev:1',
      verification: { status: 'ok', checks: [fileOk], job: expect.any(String), seq: 0 },
    })
  })

  // The stats write is the settings file, which can be locked on Windows or sit in a synced
  // folder. It runs after the file landed and the original was removed, so failing the job
  // there reported a finished conversion as failed with the source already gone.
  it('still reports success when recording the stats fails', async () => {
    const deps = makeDeps({
      recordConversion: vi.fn(() => {
        throw new Error('EPERM: operation not permitted')
      }),
    })
    const result = await runProcessTrack(job(), deps)
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  it('skips the cover stage when the job names no artwork', async () => {
    const deps = makeDeps({ hasCoverSource: vi.fn(() => false) })
    await runProcessTrack(job(), deps)

    expect(deps.prepareProcessedCover).not.toHaveBeenCalled()
    const stages = (deps.sendProgress as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(stages).toEqual(['converting', 'verify'])
  })

  it('prefers the job’s click-repair override over the settings default', async () => {
    const deps = makeDeps({
      settings: settings({ declick: { mode: 'standard', noise: 'off' } }),
    })
    await runProcessTrack(job({ declick: { mode: 'strong', noise: 'off' } }), deps)
    const call = (deps.convertAudio as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[9]).toEqual({ mode: 'strong', noise: 'off' })
  })

  // Unlike declick, trim has no settings default — it only exists as the per-track
  // range the user confirmed in the editor, so it rides the job or not at all.
  it('threads the job’s silence trim through to the encoder', async () => {
    const deps = makeDeps()
    await runProcessTrack(job({ trim: { startSec: 1.5, endSec: 200 } }), deps)
    const call = (deps.convertAudio as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[10]).toEqual({ startSec: 1.5, endSec: 200 })
  })

  // The inspector's foreign-tag deletions ride the job like trim — no Settings
  // fallback, only meaningful per track — and must reach convertAudio so ffmpeg.ts
  // can thread them into convertArgs/writeTags.
  it('threads the job’s foreign-tag removals through to the encoder', async () => {
    const deps = makeDeps()
    await runProcessTrack(job({ foreignRemoved: ['SERATO_MARKERS_V2', 'TRAKTOR4'] }), deps)
    const call = (deps.convertAudio as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[12]).toEqual(['SERATO_MARKERS_V2', 'TRAKTOR4'])
  })

  it('surfaces the repaired-sample count the encoder reported', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async () => ({
        normalizeSkipped: false,
        declickedSamples: 42,
        written,
      })),
    })
    const result = await runProcessTrack(job(), deps)
    expect(result.declickedSamples).toBe(42)
  })

  it('surfaces a failed loudness pass through normalizeSkipped', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async () => ({
        normalizeSkipped: true,
        written,
      })),
    })
    const result = await runProcessTrack(job(), deps)
    expect(result.normalizeSkipped).toBe(true)
  })

  it('attaches the job playlists to the file it wrote so the rekordbox batch can queue them', async () => {
    const attachRekordboxPlaylists = vi.fn()
    const result = await runProcessTrack(
      job({ rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] }),
      makeDeps({ attachRekordboxPlaylists }),
    )
    expect(attachRekordboxPlaylists).toHaveBeenCalledWith(
      result.outputPath,
      [{ id: '3000', name: 'Makina' }],
      undefined,
    )
  })

  it('attaches the membership the user edited against with the playlists', async () => {
    const attachRekordboxPlaylists = vi.fn()
    const result = await runProcessTrack(
      job({
        rekordboxPlaylists: [{ id: '3000', name: 'Makina' }],
        rekordboxPlaylistsBase: ['2000'],
      }),
      makeDeps({ attachRekordboxPlaylists }),
    )
    expect(attachRekordboxPlaylists).toHaveBeenCalledWith(
      result.outputPath,
      [{ id: '3000', name: 'Makina' }],
      ['2000'],
    )
  })

  it('attaches the Traktor and Engine DJ playlists with the membership they were edited against', async () => {
    const attachLibraryPlaylists = vi.fn()
    const result = await runProcessTrack(
      job({
        traktorPlaylists: [{ id: 'fri', name: 'Friday' }],
        traktorPlaylistsBase: ['old'],
        enginePlaylists: [{ id: '7', name: 'House' }],
      }),
      makeDeps({ attachLibraryPlaylists }),
    )
    expect(attachLibraryPlaylists).toHaveBeenCalledWith(result.outputPath, 'traktor', {
      wanted: [{ id: 'fri', name: 'Friday' }],
      base: ['old'],
    })
    expect(attachLibraryPlaylists).toHaveBeenCalledWith(result.outputPath, 'engine', {
      wanted: [{ id: '7', name: 'House' }],
      base: [],
    })
  })

  it('attaches nothing when the field was never touched', async () => {
    const attachRekordboxPlaylists = vi.fn()
    const attachLibraryPlaylists = vi.fn()
    await runProcessTrack(job(), makeDeps({ attachRekordboxPlaylists, attachLibraryPlaylists }))
    expect(attachRekordboxPlaylists).not.toHaveBeenCalled()
    expect(attachLibraryPlaylists).not.toHaveBeenCalled()
  })
})

// A row whose tag read failed carries a name-parsed title and artist and nothing else. It
// used to be convertible like any other: with "replace the original" or an update, every
// managed field was written empty over a file that, for a transient failure (a NAS hiccup,
// a timed-out probe), still had all of them. A read that failed must never become a write.
describe('runProcessTrack — metadata that never came from the file', () => {
  it('refuses the job with a translatable error before touching anything', async () => {
    const deps = makeDeps()
    const err = await runProcessTrack(job({ metaUnread: true }), deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(errorKeyOf((err as Error).message)).toBe('sourceTagsUnread')
    expect(deps.convertAudio).not.toHaveBeenCalled()
    expect(deps.prepareProcessedCover).not.toHaveBeenCalled()
  })
})

// A failed conversion reached the user only as a toast: nothing in main.log, so a report
// of "-83 on rename" from an external disk arrived with no evidence beyond a screenshot,
// and the "Send feedback" report, which attaches the log's error lines, carried none.
describe('runProcessTrack — a failed job', () => {
  it('writes the file and the error to the log before rejecting', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined as never)
    const failure = Object.assign(new Error('EEXIST: file already exists, rename'), {
      code: 'EEXIST',
    })
    const deps = makeDeps({
      convertAudio: vi.fn(async () => {
        throw failure
      }),
    })

    await expect(runProcessTrack(job(), deps)).rejects.toBe(failure)

    expect(error).toHaveBeenCalledWith('process:track failed', '/in/song.wav', failure)
    error.mockRestore()
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    )
    const stages = (deps.sendProgress as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(stages).toEqual(['cover', 'converting', 'verify'])
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

  // Keeping both is a promise about the file already in the folder, and in overwrite
  // mode it has to become a promise about the source too: the conversion no longer
  // lands on the source's own path, so unlinking it would delete a third file the
  // dialog never mentioned. besideOriginal already guards this with inPlace false.
  it('keeps the source when overwrite mode steps aside for keep-both', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn((p) => p === '/in/Artist - Title.aiff'),
      confirmConflict: vi.fn(async () => 'keepBoth' as const),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/in/Artist - Title (2).aiff')
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
  })

  // The same step-aside, reached by the other door: overwrite was chosen but the path
  // is only reserved by another job in this run, so this one moves to "(2)" as well.
  it('keeps the source when overwrite steps aside for a reservation', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn(() => false),
      isPathReserved: vi.fn((p) => p === '/in/Artist - Title.aiff'),
      confirmConflict: vi.fn(async () => 'overwrite' as const),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/in/Artist - Title (2).aiff')
    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  // The copy of an overwritten file is only kept when the user chose to overwrite it: a
  // re-export over the track's own previous output must not stack copies in the trash.
  it('asks the conversion to keep the file only when the user chose to overwrite it', async () => {
    const chosen = conflicting()
    chosen.confirmConflict = vi.fn(async () => 'overwrite' as const)
    await runProcessTrack(job(), chosen)
    expect(vi.mocked(chosen.convertAudio).mock.calls[0][14]).toBe(true)

    const reexport = conflicting()
    await runProcessTrack(
      job({ previousOutputPath: '/out/Artist - Title.aiff', previousOutputIdentity: 'dev:1' }),
      reexport,
    )
    expect(vi.mocked(reexport.convertAudio).mock.calls[0][14]).toBe(false)
  })

  it('never prompts when the colliding file is the track’s own previous output', async () => {
    const deps = conflicting()
    await runProcessTrack(
      job({ previousOutputPath: '/out/Artist - Title.aiff', previousOutputIdentity: 'dev:1' }),
      deps,
    )
    expect(deps.confirmConflict).not.toHaveBeenCalled()
    expect(deps.convertAudio).toHaveBeenCalledOnce()
  })

  // The path alone does not make the file this track's: another track of the session can
  // have been written over it since (the user chose Overwrite there). Re-exporting with no
  // prompt then replaced that other track's file without a word.
  it('prompts when the previous output has since been replaced by another file', async () => {
    const deps = conflicting()
    deps.fileIdentity = vi.fn(async () => 'dev:2')
    await runProcessTrack(
      job({ previousOutputPath: '/out/Artist - Title.aiff', previousOutputIdentity: 'dev:1' }),
      deps,
    )
    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', false)
  })

  it('reports the identity of the file it wrote, so the next export can recognise it', async () => {
    const deps = makeDeps({
      fileIdentity: vi.fn(async (p: string) => (p === '/out/Artist - Title.aiff' ? 'dev:7' : '')),
    })
    const result = await runProcessTrack(job(), deps)
    expect(result.outputIdentity).toBe('dev:7')
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

    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', true)
    expect(result.outputPath).toBe('/out/Artist - Title (2).aiff')
  })

  // Overwriting a file the user can see in the destination folder is their call. A
  // reservation is not that file: it is another in-flight job's path, with nothing
  // written there yet. Honouring overwrite against one points both jobs at a single
  // destination, so the second rename lands on the first and that track is gone while
  // the run still counts it converted.
  it('does not overwrite a path another in-flight job has reserved', async () => {
    const deps = makeDeps({
      isPathReserved: vi.fn((p: string) => p === '/out/Artist - Title.aiff'),
    })
    deps.confirmConflict = vi.fn(async () => 'overwrite' as const)

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/out/Artist - Title (2).aiff')
  })

  // The same choice against a real file on disk must still overwrite it — that is the
  // whole point of the option, and the reservation guard above must not disarm it.
  it('overwrites a file that really exists on disk', async () => {
    const deps = makeDeps({
      existsSync: vi.fn((p: string) => p === '/out/Artist - Title.aiff'),
    })
    deps.confirmConflict = vi.fn(async () => 'overwrite' as const)

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  // The name is on disk AND a sibling job of the same run resolved to it. Overwrite is a
  // consent to replace the file already there, once: with "apply to the rest" both jobs
  // answer overwrite, and aiming both at the one path made the second rename land on the
  // first. Two tracks went in, one came out, and the run counted two conversions.
  it('never lets two jobs of one run overwrite the same file on disk', async () => {
    const reservations = createOutputReservations(false)
    const release: Array<() => void> = []
    const deps = makeDeps({
      existsSync: vi.fn((p: string) => p === '/out/Artist - Title.aiff'),
      isPathReserved: reservations.isReserved,
      reservePath: reservations.reserve,
      releasePath: reservations.release,
      confirmConflict: vi.fn(async () => 'overwrite' as const),
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(
        () =>
          new Promise((resolve) =>
            release.push(() => resolve({ normalizeSkipped: false, written })),
          ),
      ),
    })

    const first = runProcessTrack(job({ id: 'a' }), deps)
    const second = runProcessTrack(job({ id: 'b', inputPath: '/in/other.wav' }), deps)
    await vi.waitFor(() => expect(release).toHaveLength(2))
    for (const done of release) done()
    const outputs = [(await first).outputPath, (await second).outputPath]

    expect(outputs).toEqual(['/out/Artist - Title.aiff', '/out/Artist - Title (2).aiff'])
  })

  // Overwrite on, and a folder holding Song.flac and Song.wav: both become Song.aiff in
  // place of their own source. The check for a sibling's claim must come after the wait to
  // learn whether the name is the source itself, or both jobs read the name as free before
  // either claims it, both write it, and the folder ends with one recording of two.
  it('never lets two in-place jobs of one run land on the same new name', async () => {
    const reservations = createOutputReservations(false)
    const release: Array<() => void> = []
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      isPathReserved: reservations.isReserved,
      reservePath: reservations.reserve,
      releasePath: reservations.release,
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(
        () =>
          new Promise((resolve) =>
            release.push(() => resolve({ normalizeSkipped: false, written })),
          ),
      ),
    })

    const first = runProcessTrack(
      job({ id: 'a', inputPath: '/in/Song.flac', outputName: 'Song' }),
      deps,
    )
    const second = runProcessTrack(
      job({ id: 'b', inputPath: '/in/Song.wav', outputName: 'Song' }),
      deps,
    )
    await vi.waitFor(() => expect(release).toHaveLength(2))
    for (const done of release) done()
    const outputs = [(await first).outputPath, (await second).outputPath]

    expect(outputs).toEqual(['/in/Song.aiff', '/in/Song (2).aiff'])
  })

  // With "Add to Engine DJ" on, each job waits to learn whether Engine is open. Waited
  // between reading the name as free and claiming it, both jobs of a run read it free, both
  // wrote it, and the batch said 2 converted with one file left in the folder.
  it('never lets two jobs land on the same name while they wait to learn whether Engine DJ is open', async () => {
    const reservations = createOutputReservations(false)
    const release: Array<() => void> = []
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      isEngineDjRunning: vi.fn(async () => false),
      isPathReserved: reservations.isReserved,
      reservePath: reservations.reserve,
      releasePath: reservations.release,
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(
        () =>
          new Promise((resolve) =>
            release.push(() => resolve({ normalizeSkipped: false, written })),
          ),
      ),
    })

    const first = runProcessTrack(job({ id: 'a' }), deps)
    const second = runProcessTrack(job({ id: 'b', inputPath: '/in/other.wav' }), deps)
    await vi.waitFor(() => expect(release).toHaveLength(2))
    for (const done of release) done()
    const outputs = [(await first).outputPath, (await second).outputPath]

    expect(outputs).toEqual(['/out/Artist - Title.aiff', '/out/Artist - Title (2).aiff'])
  })

  // The prompt is what the user consents on. A claim by another job in the run has no file
  // behind it yet, so a prompt reading "already exists in the destination folder" asked
  // about a file that was not there; the prompt is told which of the two it is facing.
  it('tells the prompt whether the name is a file on disk or only a claim by another job', async () => {
    const onDisk = makeDeps({ existsSync: vi.fn((p: string) => p === '/out/Artist - Title.aiff') })
    await runProcessTrack(job(), onDisk)
    expect(onDisk.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', false)

    const claimed = makeDeps({
      isPathReserved: vi.fn((p: string) => p === '/out/Artist - Title.aiff'),
    })
    await runProcessTrack(job(), claimed)
    expect(claimed.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', true)
  })

  // The two halves wired together, against the real registry instead of a fake: the
  // guards above prove runProcessTrack reacts to a reservation, and outputReservations'
  // own tests prove it folds case, but only this says the batch is actually safe. Two
  // tracks whose tags differ just in case (a Discogs match filling "Artist" beside a
  // sibling tagged "artist") resolve to one file on macOS/Windows, and before the fold
  // the second job saw the first job's claim as a different path, sailed past the
  // conflict check and renamed over it: "2 converted", one file on disk.
  it('sees a claim another job made under a different case', async () => {
    const reservations = createOutputReservations(true)
    const deps = makeDeps({
      isPathReserved: reservations.isReserved,
      reservePath: reservations.reserve,
      releasePath: reservations.release,
    })
    deps.confirmConflict = vi.fn(async () => 'keepBoth' as const)

    // The first job is still in flight — nothing on disk yet, only its claim.
    reservations.reserve('/out/artist - title.aiff')

    const result = await runProcessTrack(job(), deps)

    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', true)
    expect(result.outputPath).toBe('/out/Artist - Title (2).aiff')
  })

  // The re-export pass lets a track overwrite its own previous output without a
  // prompt. That pass has to yield to a live claim: if an earlier run resolved two
  // tracks to one name and the user overwrote, both rows carry the same
  // previousOutputPath, and re-converting the pair let each one skip the check and
  // rename over the other — "2 converted", one file on disk.
  it("does not let the previous-output pass ride over another job's claim", async () => {
    const reservations = createOutputReservations(false)
    const deps = makeDeps({
      isPathReserved: reservations.isReserved,
      reservePath: reservations.reserve,
      releasePath: reservations.release,
      confirmConflict: vi.fn(async () => 'keepBoth' as const),
    })

    // The sibling job claimed the shared destination and has not written it yet.
    reservations.reserve('/out/Artist - Title.aiff')

    const result = await runProcessTrack(
      job({ previousOutputPath: '/out/Artist - Title.aiff' }),
      deps,
    )

    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', true)
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
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async (...args: unknown[]) => {
        const onChild = args[7] as (child: { kill: (s: string) => void }) => void
        onChild({ kill: vi.fn() })
        return { normalizeSkipped: false, written }
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

  // The test above hands onChild a process by hand, which hides the case that matters:
  // the stream-copy shortcut copies bytes and edits the tag in place, so it never
  // spawns a child and onChild never fires. That job is still work in flight — it is
  // the ordinary same-format retag, and AIFF is the default output format — so the
  // close guard has to see it. Registering only from onChild left a 300-track retag
  // invisible: count() stayed 0, the window closed without asking, and the queue went
  // with it. Exactly the loss quitGuard exists to prevent.
  it('counts a stream-copy job that never spawns a child as in flight', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async () => ({
        normalizeSkipped: false,
        written,
      })),
    })

    await runProcessTrack(job(), deps)

    expect(deps.beginJob).toHaveBeenCalledWith('job1')
    expect(deps.endJob).toHaveBeenCalledWith('job1')
    const begun = (deps.beginJob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const ended = (deps.endJob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(ended).toBeGreaterThan(begun)
  })

  it('releases a stream-copy job from the in-flight count when it throws', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })

    await expect(runProcessTrack(job(), deps)).rejects.toThrow('disk full')

    expect(deps.endJob).toHaveBeenCalledWith('job1')
  })
})

describe('runProcessTrack — orphaned tmp trail', () => {
  // convertAudio's own catch already deletes the tmp on a normal failure, so
  // trackTmp/untrackTmp exist purely for the case that skips that catch entirely:
  // the whole app quitting or crashing mid-encode. The manifest is what the next
  // launch sweeps.
  it('tracks the tmp path the instant convertAudio picks it, untracking it once the job settles', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async (...args: unknown[]) => {
        const onTmp = args[8] as (path: string) => void
        onTmp('/out/Artist - Title.tmp-a1b2c3d4.aiff')
        return { normalizeSkipped: false, written }
      }),
    })
    await runProcessTrack(job(), deps)

    expect(deps.trackTmp).toHaveBeenCalledWith('/out/Artist - Title.tmp-a1b2c3d4.aiff')
    expect(deps.untrackTmp).toHaveBeenCalledWith('/out/Artist - Title.tmp-a1b2c3d4.aiff')
  })

  it('still untracks the tmp path when the encode throws', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async (...args: unknown[]) => {
        const onTmp = args[8] as (path: string) => void
        onTmp('/out/Artist - Title.tmp-a1b2c3d4.aiff')
        throw new Error('disk full')
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow('disk full')
    expect(deps.untrackTmp).toHaveBeenCalledWith('/out/Artist - Title.tmp-a1b2c3d4.aiff')
  })

  // The manifest is the ONLY record of a temp that outlived its conversion, and
  // untracking on a failed delete throws that record away: the file is still on disk,
  // no longer listed, so no later sweep will ever find it. On a network volume — where
  // the delete is the operation most likely to fail — that is how a `.tmp-` ends up
  // parked in the user's music folder for good, read as "a file that never finished".
  it('keeps the tmp path listed when the cleanup could not delete it', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async (...args: unknown[]) => {
        const onTmp = args[8] as (path: string) => void
        onTmp('/nas/Artist - Title.tmp-a1b2c3d4.flac')
        throw Object.assign(new Error('EBUSY: resource busy'), { tmpSurvived: true })
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow('EBUSY')
    expect(deps.untrackTmp).not.toHaveBeenCalled()
  })

  // A delete that fails with ENOENT means there is nothing left behind: the encode died
  // before writing the temp, or it is already gone. Recording that as litter would leave
  // the manifest naming files that do not exist, and every later sweep chasing ghosts.
  it('untracks normally when the temp was already gone', async () => {
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async (...args: unknown[]) => {
        const onTmp = args[8] as (path: string) => void
        onTmp('/out/Artist - Title.tmp-a1b2c3d4.aiff')
        throw new Error('encode died before writing anything')
      }),
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow()
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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
      job({
        outputName: 'song',
        format: 'wav',
        previousOutputPath: '/in/song (2).wav',
        previousOutputIdentity: 'dev:1',
      }),
      deps,
    )
    expect(result.outputPath).toBe('/in/song (2).wav')
    expect(deps.confirmConflict).not.toHaveBeenCalled()
  })

  // The mode never touches a file that is not this track's own copy, and a "(2)" another
  // track has been written over since is not that copy any more.
  it('steps past its previous copy once another file has replaced it', async () => {
    const deps = makeDeps({
      settings: settings({ convertBesideOriginal: true }),
      existsSync: vi.fn((p: string) => p === '/in/song.wav' || p === '/in/song (2).wav'),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
      fileIdentity: vi.fn(async () => 'dev:2'),
    })
    const result = await runProcessTrack(
      job({
        outputName: 'song',
        format: 'wav',
        previousOutputPath: '/in/song (2).wav',
        previousOutputIdentity: 'dev:1',
      }),
      deps,
    )
    expect(result.outputPath).toBe('/in/song (3).wav')
  })

  it("does not let its own previous copy ride over another job's claim", async () => {
    const reservations = createOutputReservations(false)
    const deps = makeDeps({
      settings: settings({ convertBesideOriginal: true }),
      isPathReserved: reservations.isReserved,
      reservePath: reservations.reserve,
      releasePath: reservations.release,
    })
    reservations.reserve('/in/song.aiff')

    const result = await runProcessTrack(
      job({ outputName: 'song', previousOutputPath: '/in/song.aiff' }),
      deps,
    )

    expect(result.outputPath).toBe('/in/song (2).aiff')
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

describe('runProcessTrack — a source main never handed out', () => {
  it('refuses to convert a file that is not one of the tracks the app accepted', async () => {
    const deps = makeDeps({ isAllowed: vi.fn(() => false) })

    await expect(runProcessTrack(job(), deps)).rejects.toThrow('pathNotAllowed')
    expect(deps.convertAudio).not.toHaveBeenCalled()
  })

  it('converts a track the app accepted', async () => {
    const isAllowed = vi.fn(() => true)
    const deps = makeDeps({ isAllowed })

    await runProcessTrack(job(), deps)
    expect(isAllowed).toHaveBeenCalledWith('/in/song.wav')
    expect(deps.convertAudio).toHaveBeenCalled()
  })
})

describe('runProcessTrack — Engine DJ open before the write', () => {
  it('leaves the Engine add to its queue while Engine DJ is open, so the conversion finishes instead of asking to close it', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true, addToEngineDj: true }),
      isEngineDjRunning: vi.fn(async () => true),
    })

    const result = await runProcessTrack(job(), deps)
    expect(deps.convertAudio).toHaveBeenCalled()
    expect(deps.addToEngineDj).not.toHaveBeenCalled()
    expect(result.engineDjQueued).toBe(true)
    expect(result.engineDjError).toBeUndefined()
    expect(result.addedToEngineDj).toBeUndefined()
  })

  it('leaves the Engine add to its queue when it cannot tell whether Engine DJ is open, since writing under a live Engine loses the library', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      isEngineDjRunning: vi.fn(async () => {
        throw new Error('pgrep failed')
      }),
    })

    const result = await runProcessTrack(job(), deps)
    expect(deps.addToEngineDj).not.toHaveBeenCalled()
    expect(result.engineDjQueued).toBe(true)
  })

  it('registers in Engine DJ right away while it is closed, with the cover the job processed', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      isEngineDjRunning: vi.fn(async () => false),
    })

    const result = await runProcessTrack(job(), deps)
    expect(deps.addToEngineDj).toHaveBeenCalled()
    expect(result.addedToEngineDj).toBe(true)
    expect(result.engineDjQueued).toBeUndefined()
  })

  it('does not ask about Engine DJ when the job does not add to it', async () => {
    const isEngineDjRunning = vi.fn(async () => true)
    const deps = makeDeps({ isEngineDjRunning })

    await runProcessTrack(job(), deps)
    expect(isEngineDjRunning).not.toHaveBeenCalled()
  })
})

describe('runProcessTrack — in-place rewrite', () => {
  // Retiring the old-format original is the last, cheapest step, and on Windows it can
  // fail after the new file has landed (an EBUSY on the unlink that ends a copy into the
  // trash on another volume). Thrown, it reported a finished conversion as failed and
  // skipped Apple Music and Engine DJ for a file that is already in place.
  it('finishes the job and says the original stayed when it cannot be retired', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true, addToEngineDj: true }),
      removeRenamedOriginal: vi.fn(async () => {
        throw Object.assign(new Error('EBUSY: resource busy or locked, unlink'), { code: 'EBUSY' })
      }),
    })
    const result = await runProcessTrack(job(), deps)

    expect(result).toMatchObject({ outputPath: '/in/Artist - Title.aiff', inPlace: true })
    expect(result.originalKept).toBe(true)
    expect(deps.recordConversion).toHaveBeenCalledOnce()
    expect(deps.addToEngineDj).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  // Updating a file in place under its own name must land on that name. "Aux" is a device
  // name to Windows, but a file already called Aux.aiff lives on this disk: renaming it to
  // Aux_.aiff moved the original to the backups and broke every library path to it.
  it('keeps the file on its own name when an in-place update asks for that name', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true }),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
    })
    await runProcessTrack(job({ inputPath: '/in/Aux.aiff', outputName: 'Aux' }), deps)

    expect(vi.mocked(deps.convertAudio).mock.calls[0][1]).toBe('/in/Aux.aiff')
    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith('/in/Aux.aiff', '/in/Aux.aiff')
  })

  // A name with "?" or accents is already on this disk, so the update has nothing to fix
  // in it. Changed, the rename sent the original to the backups and every DJ library that
  // was not synced lost the track, which Apple Music then replaced as a new entry.
  it('keeps an in-place update on its own name even with "?" or accents in it', async () => {
    const deps = makeDeps({
      settings: settings({ overwriteOriginal: true, asciiFileNames: true }),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
    })
    await runProcessTrack(
      job({ inputPath: "/in/Where's Your Head At?.aiff", outputName: "Where's Your Head At?" }),
      deps,
    )
    await runProcessTrack(
      job({ inputPath: '/in/Röyksopp - Fiësta.aiff', outputName: 'Röyksopp - Fiësta' }),
      deps,
    )

    expect(vi.mocked(deps.convertAudio).mock.calls.map((c) => c[1])).toEqual([
      "/in/Where's Your Head At?.aiff",
      '/in/Röyksopp - Fiësta.aiff',
    ])
  })

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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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

    expect(deps.confirmConflict).toHaveBeenCalledWith('Artist - Title.aiff', false)
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
    await expect(
      runProcessTrack(job({ meta: { artist: 'Artist', title: 'Title' } as TrackMetadata }), deps),
    ).rejects.toThrow()
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('added-id', 'Artist - Title')
    expect(deps.rm).toHaveBeenCalled()
  })

  it('cleans the temp and succeeds when Music copied the file into its own folder', async () => {
    const deps = musicOnly()
    deps.appleMusicEntryLocation = vi.fn(async () => '/Users/me/Music/Media/Artist - Title.aiff')
    const result = await runProcessTrack(job(), deps)
    expect(result.addedToMusicOnly).toBe(true)
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
  })

  const replacement = job({
    meta: { artist: 'Artist', title: 'Title' } as TrackMetadata,
    addToAppleMusic: true,
    musicPersistentId: 'old-id',
    replacesPath: '/m/old.mp3',
    replacesLabel: 'Old Artist - Old Title',
  })

  // The check used to run after the swap: the old entry was already deleted when the new
  // one, pointing at a temp file about to vanish, was rolled back too, and the track left
  // Music altogether. Only the new entry may be undone, and the DJ must hear that the old
  // copy is still there.
  it('rolls back only the new entry and keeps the old one when Music referenced the temp file', async () => {
    const deps = musicOnly()
    deps.appleMusicEntryLocation = vi.fn(async () => '/tmp/surco-abc/Artist - Title.aiff')

    await expect(runProcessTrack(replacement, deps)).rejects.toThrow('appleMusicNoMediaCopyKept')

    expect(deps.deleteAppleMusic).toHaveBeenCalledOnce()
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('added-id', 'Artist - Title')
    expect(deps.carryAppleMusicHistory).not.toHaveBeenCalled()
  })

  // Copying the playlists onto an entry that is about to be rolled back would be wasted at
  // best; deleting the old one before knowing the new one plays is the bug above.
  it('checks where the new entry points before carrying anything over or deleting the old one', async () => {
    const calls: string[] = []
    const deps = musicOnly()
    deps.addToAppleMusic = vi.fn(async () => {
      calls.push('add')
      return 'added-id'
    })
    deps.appleMusicEntryLocation = vi.fn(async () => {
      calls.push('locate')
      return '/Users/me/Music/Media/Artist - Title.aiff'
    })
    deps.carryAppleMusicHistory = vi.fn(async () => {
      calls.push('carry')
      return 'carried' as const
    })
    deps.deleteAppleMusic = vi.fn(async (pid: string) => {
      calls.push(`delete ${pid}`)
    })

    await runProcessTrack(replacement, deps)

    expect(calls).toEqual(['add', 'locate', 'carry', 'delete old-id'])
  })
})

describe('replaceAppleMusicCopy — playlists before the add', () => {
  const replacing = job({
    meta: { artist: 'Artist', title: 'Title' } as TrackMetadata,
    addToAppleMusic: true,
    musicPersistentId: 'old-id',
    replacesLabel: 'Old Artist - Old Title',
  })

  // The self-check proves the carry by finding the new entry in every normal playlist the
  // old one was in. Read after the carry, the old entry would already be gone.
  it('a replacement returns the playlists the old entry had before the add', async () => {
    const calls: string[] = []
    const deps = makeDeps({
      appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async (pid) => {
        calls.push(`playlists ${pid}`)
        return ['24', 'All']
      }),
      addToAppleMusic: vi.fn<ProcessTrackDeps['addToAppleMusic']>(async () => {
        calls.push('add')
        return 'added-id'
      }),
    })

    const replaced = await replaceAppleMusicCopy(
      replacing,
      '/out/Artist - Title.wav',
      undefined,
      deps,
      undefined,
    )

    expect(replaced.playlistsBefore).toEqual(['24', 'All'])
    expect(calls).toEqual(['playlists old-id', 'add'])
  })

  // An unread list must not pass for "it was in no playlist": the check then has nothing
  // to hold the new entry to and would say ok.
  it('a replacement whose old playlists could not be read says so and still replaces', async () => {
    const deps = makeDeps({
      appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async () => {
        throw new Error('Apple Music did not answer in time')
      }),
    })

    const replaced = await replaceAppleMusicCopy(
      replacing,
      '/out/Artist - Title.wav',
      undefined,
      deps,
      undefined,
    )

    expect(replaced.playlistsBefore).toBeNull()
    expect(replaced.added).toBe('added-id')
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('old-id', 'Old Artist - Old Title')
  })

  it('a plain add reads no playlists', async () => {
    const deps = makeDeps()

    const replaced = await replaceAppleMusicCopy(
      job({ addToAppleMusic: true, musicPersistentId: undefined }),
      '/out/Artist - Title.wav',
      undefined,
      deps,
      undefined,
    )

    expect(deps.appleMusicPlaylists).not.toHaveBeenCalled()
    expect(replaced.playlistsBefore).toBeUndefined()
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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
  // Apple Music" would still convert to wherever Settings points.
  it('keeps registering in Engine DJ when the job picks another destination', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
    })
    await runProcessTrack(
      job({
        addToAppleMusic: false,
        keepOutputCopy: true,
        addToEngineDj: false,
      } as Partial<ProcessJob>),
      deps,
    )
    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      undefined,
      '/in/song.wav',
    )
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

  it('reports a renamed file as converted when the Music update fails afterwards, so the row follows the file', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.updateInAppleMusic = vi.fn(async () => {
      throw new Error('Music got an error (1000)')
    })
    const result = await runProcessTrack(job({ musicPersistentId: 'lib-7' }), deps)

    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/Artist - Title.aiff',
    )
    expect(result).toMatchObject({
      outputPath: '/in/Artist - Title.aiff',
      inPlace: true,
      appleMusicFailed: true,
    })
    expect(result.musicPersistentId).toBeUndefined()
  })

  it('reports a written copy as converted when the Music add fails afterwards', async () => {
    const deps = mac()
    deps.addToAppleMusic = vi.fn(async () => {
      throw new Error('Music got an error (1000)')
    })
    const result = await runProcessTrack(job(), deps)

    expect(result).toMatchObject({ outputPath: '/out/Artist - Title.aiff', appleMusicFailed: true })
  })

  it('still fails "Apple Music only" when the add fails, since no file was kept', async () => {
    const deps = mac({ keepOutputCopy: false })
    deps.addToAppleMusic = vi.fn(async () => {
      throw new Error('Music got an error (1000)')
    })
    await expect(runProcessTrack(job(), deps)).rejects.toThrow('1000')
  })

  it('updates the Music entry that already holds the rewritten file instead of adding a second one', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.isSameFile = vi.fn(async () => true)
    deps.findAppleMusicEntry = vi.fn(async () => ({ persistentId: 'lib-9', label: 'A - Old' }))
    const result = await runProcessTrack(job({ outputName: 'song', format: 'wav' }), deps)

    expect(deps.findAppleMusicEntry).toHaveBeenCalledWith('/in/song.wav', {})
    expect(vi.mocked(deps.findAppleMusicEntry).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.convertAudio).mock.invocationCallOrder[0],
    )
    expect(deps.updateInAppleMusic).toHaveBeenCalledWith('lib-9', {}, undefined)
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(result.musicPersistentId).toBe('updated-id')
  })

  it('moves the Music entry of a file the conversion renamed onto the new file, retiring the old one', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.findAppleMusicEntry = vi.fn(async () => ({ persistentId: 'lib-9', label: 'A - Old' }))
    const result = await runProcessTrack(job(), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/in/Artist - Title.aiff', {}, undefined)
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('lib-9', 'A - Old')
    expect(result.musicPersistentId).toBe('added-id')
  })

  // The old entry plays the original until the replacement retires it. Retiring the original
  // first left that entry playing a file that was gone whenever the replacement then failed
  // or had to keep the old entry: Music handing back an entry, a refused carry, a timeout.
  it('retires the renamed original only once its Music entry has been replaced', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.findAppleMusicEntry = vi.fn(async () => ({ persistentId: 'lib-9', label: 'A - Old' }))
    await runProcessTrack(job(), deps)

    expect(vi.mocked(deps.removeRenamedOriginal).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(deps.deleteAppleMusic).mock.invocationCallOrder[0],
    )
  })

  it('keeps the renamed original when its Music entry could not be replaced', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.findAppleMusicEntry = vi.fn(async () => ({ persistentId: 'lib-9', label: 'A - Old' }))
    deps.addToAppleMusic = vi.fn(async () => {
      throw new Error('SURCO_ERR:appleMusicAddReturnedOld: lib-9')
    })
    const result = await runProcessTrack(job(), deps)

    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(result.appleMusicFailed).toBe(true)
    expect(result.originalKept).toBe(true)
  })

  it('keeps the renamed original when the old Music entry had to be kept', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.findAppleMusicEntry = vi.fn(async () => ({ persistentId: 'lib-9', label: 'A - Old' }))
    deps.carryAppleMusicHistory = vi.fn(async () => 'mismatch' as const)
    const result = await runProcessTrack(job(), deps)

    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(result.oldMusicCopyKept).toBe('mismatch')
    expect(result.originalKept).toBe(true)
  })

  it("carries the renamed file's playlists, play count and rating onto its new Music entry", async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.findAppleMusicEntry = vi.fn(async () => ({ persistentId: 'lib-9', label: 'A - Old' }))
    await runProcessTrack(job(), deps)

    expect(deps.carryAppleMusicHistory).toHaveBeenCalledWith('lib-9', 'added-id', 'A - Old')
  })

  it('adds as before when Music holds no entry for the file', async () => {
    const deps = mac({ overwriteOriginal: true })
    deps.findAppleMusicEntry = vi.fn(async () => undefined)
    const result = await runProcessTrack(job(), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledOnce()
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.musicPersistentId).toBe('added-id')
  })

  it('looks nothing up for a track that already knows its Music entry or for a new copy', async () => {
    const known = mac({ overwriteOriginal: true })
    known.findAppleMusicEntry = vi.fn(async () => undefined)
    await runProcessTrack(job({ musicPersistentId: 'lib-7' }), known)
    const copy = mac()
    copy.findAppleMusicEntry = vi.fn(async () => undefined)
    await runProcessTrack(job(), copy)

    expect(known.findAppleMusicEntry).not.toHaveBeenCalled()
    expect(copy.findAppleMusicEntry).not.toHaveBeenCalled()
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

    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      undefined,
      '/in/song.wav',
    )
    expect(deps.sendProgress).toHaveBeenCalledWith('engineDj')
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
  })

  // The library row to move onto the new file is the one of the file this conversion
  // supersedes: the Apple Music copy being replaced when there is one, else the source.
  it('names the replaced library copy as the file the Engine row should move from', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
    })
    await runProcessTrack(job({ replacesPath: '/m/old.mp3' }), deps)

    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      undefined,
      '/m/old.mp3',
    )
  })

  // Engine only renders art stored in its own database, so the processed cover the
  // conversion embedded must also reach the library add.
  it('hands the prepared cover to the Engine library add', async () => {
    const deps = makeDeps({ settings: settings({ addToEngineDj: true }) })
    await runProcessTrack(job({ coverPath: '/art/cover.jpg' }), deps)

    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      '/tmp/cover.jpg',
      '/in/song.wav',
    )
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
      '/in/song.wav',
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
    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      undefined,
      '/in/song.wav',
    )
  })

  it('leaves the Engine library alone when the setting is off', async () => {
    const deps = makeDeps()
    await runProcessTrack(job(), deps)
    expect(deps.addToEngineDj).not.toHaveBeenCalled()
  })

  // A failed registration must fail the job loudly: reporting success while the library
  // was never touched would hide the miss. But the file has landed by then, renamed and
  // with the original retired when in place, so the result still says where it is: thrown,
  // the row kept pointing at a source that was gone and a retry failed on a missing file.
  it('reports a failed Engine library write along with where the file landed', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true, overwriteOriginal: true }),
      addToEngineDj: vi.fn(async () => {
        throw new Error('biblioteca abierta')
      }),
    })
    const result = await runProcessTrack(job(), deps)

    expect(result).toMatchObject({
      outputPath: '/in/Artist - Title.aiff',
      inPlace: true,
      engineDjError: 'biblioteca abierta',
    })
    expect(result.addedToEngineDj).toBeUndefined()
    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith(
      '/in/song.wav',
      '/in/Artist - Title.aiff',
    )
    warn.mockRestore()
  })
})

describe('runProcessTrack — Apple Music and Engine DJ together', () => {
  it('adds the output-folder file to both libraries when the copy is kept', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, addToEngineDj: true, keepOutputCopy: true }),
    })
    const result = await runProcessTrack(job(), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/out/Artist - Title.aiff', {}, undefined)
    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      '/tmp/cover.jpg',
      '/in/song.wav',
    )
    expect(deps.rm).not.toHaveBeenCalled()
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
    expect(result.addedToEngineDj).toBe(true)
  })

  it('keeps the output copy for Engine DJ even when Apple Music alone would drop it', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, addToEngineDj: true, keepOutputCopy: false }),
    })
    const result = await runProcessTrack(job(), deps)

    expect(deps.mkdtemp).not.toHaveBeenCalled()
    expect(deps.addToEngineDj).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      {},
      '/tmp/cover.jpg',
      '/in/song.wav',
    )
    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
    expect(result.addedToMusicOnly).toBeUndefined()
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
      expect.any(Function),
      expect.any(Function),
      { mode: 'off', noise: 'off' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
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
      verification: {
        status: 'ok',
        checks: [fileOk, musicOkDefault],
        job: expect.any(String),
        seq: 0,
      },
    })
  })

  // The swap recipe's own destination: Apple Music with no output copy. That branch returned
  // before the superseded file was authorised, so the offer to trash the old MP3 at the end
  // failed with "Ruta no permitida" exactly where the recipe promises it.
  it('authorises the superseded file when it replaces a library copy', async () => {
    const deps = musicOnly()

    await runProcessTrack(
      job({ musicPersistentId: 'old-id', replacesPath: '/m/old.mp3', replacesLabel: 'A - T' }),
      deps,
    )

    expect(deps.allowMedia).toHaveBeenCalledWith('/m/old.mp3')
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

// Measured 30/10: Music reads no tags from a WAV at import, so the copy it makes into its
// Media folder lands in "Unknown Artist/Unknown Album" and tagging the entry afterwards never
// moves it. A file already inside the Media folder is added where it is, so "Apple Music
// only" writes the conversion straight into Music's own layout.
describe('runProcessTrack — Apple Music only into the Media folder', () => {
  const media = '/Volumes/Public/Music/Music/Media.localized'
  const meta = { artist: 'Artist', title: 'Title', album: 'Album' } as TrackMetadata
  const filed = `${media}/Music/Artist/Album/Artist - Title.wav`
  const intoMedia = (overrides: Partial<ProcessTrackDeps> = {}) =>
    makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
      appleMusicMediaFolder: vi.fn(async () => media),
      existsSync: vi.fn((p: string) => p === media),
      mkdir: vi.fn(async () => `${media}/Music/Artist`),
      appleMusicEntryLocation: vi.fn(async () => filed),
      appleMusicHoldsFile: vi.fn(async () => false),
      ...overrides,
    })
  const musicJob = (over: Partial<ProcessJob> = {}) =>
    job({ inputPath: '/in/song.aiff', meta, format: 'wav', ...over })

  it('writes the conversion where Music files it and adds it from there, keeping it', async () => {
    const deps = intoMedia()

    const result = await runProcessTrack(musicJob(), deps)

    expect(deps.mkdtemp).not.toHaveBeenCalled()
    expect(deps.mkdir).toHaveBeenCalledWith(`${media}/Music/Artist/Album`, { recursive: true })
    expect(vi.mocked(deps.convertAudio).mock.calls[0]?.[1]).toBe(filed)
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(filed, meta, undefined)
    expect(deps.reservePath).toHaveBeenCalledWith(filed)
    expect(deps.releasePath).toHaveBeenCalledWith(filed)
    expect(deps.rm).not.toHaveBeenCalled()
    expect(deps.rmdir).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outputPath: '', addedToMusicOnly: true })
  })

  it('files under the album artist, and under Music’s own names when the tags are empty', async () => {
    const deps = intoMedia()
    await runProcessTrack(musicJob({ meta: { ...meta, albumArtist: 'Various' } }), deps)
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      `${media}/Music/Various/Album/Artist - Title.wav`,
      expect.anything(),
      undefined,
    )

    const bare = intoMedia()
    await runProcessTrack(musicJob({ meta: { title: 'Title' } as TrackMetadata }), bare)
    expect(bare.addToAppleMusic).toHaveBeenCalledWith(
      `${media}/Music/Unknown Artist/Unknown Album/Artist - Title.wav`,
      expect.anything(),
      undefined,
    )
  })

  // A slash would open a folder of its own and a colon is what Finder shows for one.
  it('keeps a slash or colon in a tag from opening another folder', async () => {
    const deps = intoMedia()
    await runProcessTrack(
      musicJob({ meta: { ...meta, artist: 'AC/DC', album: 'Live: 1991' } }),
      deps,
    )
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      `${media}/Music/AC_DC/Live_ 1991/Artist - Title.wav`,
      expect.anything(),
      undefined,
    )
  })

  // A blank album artist is no album artist: Music files under the artist then. A folder
  // ending in a dot is renamed by an SMB share, and one starting with it is hidden.
  it('files a blank album artist under the artist and keeps dots off the folder ends', async () => {
    const deps = intoMedia()
    await runProcessTrack(
      musicJob({ meta: { ...meta, albumArtist: '   ', artist: 'Mr. Oizo.', album: '...Baby' } }),
      deps,
    )
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      `${media}/Music/Mr. Oizo/Baby/Artist - Title.wav`,
      expect.anything(),
      undefined,
    )

    const dots = intoMedia()
    await runProcessTrack(musicJob({ meta: { ...meta, artist: '...', album: '.' } }), dots)
    expect(dots.addToAppleMusic).toHaveBeenCalledWith(
      `${media}/Music/Unknown Artist/Unknown Album/Artist - Title.wav`,
      expect.anything(),
      undefined,
    )
  })

  it('removes the file and the folders it made when the add fails', async () => {
    const deps = intoMedia({
      addToAppleMusic: vi.fn(async () => {
        throw new Error('Music unavailable')
      }),
    })

    await expect(runProcessTrack(musicJob(), deps)).rejects.toThrow('Music unavailable')

    expect(deps.rm).toHaveBeenCalledWith(filed, { recursive: false, force: true })
    expect(vi.mocked(deps.rmdir).mock.calls.map((c) => c[0])).toEqual([
      `${media}/Music/Artist/Album`,
      `${media}/Music/Artist`,
    ])
  })

  // The add script can fail after Music imported the file: the 60 s wait for the tags, a
  // refused field or artwork, an Apple Event timeout. The entry it made already plays this
  // file, and deleting it left a row that plays nothing.
  it('keeps the file when an entry already plays it although the add failed', async () => {
    const deps = intoMedia({
      addToAppleMusic: vi.fn(async () => {
        throw new Error('Apple Music no terminó de importar la pista a tiempo.')
      }),
      appleMusicHoldsFile: vi.fn(async () => true),
    })

    await expect(runProcessTrack(musicJob(), deps)).rejects.toThrow('a tiempo')

    expect(deps.appleMusicHoldsFile).toHaveBeenCalledWith(filed, ['Title', 'Artist - Title'])
    expect(deps.rm).not.toHaveBeenCalled()
    expect(deps.rmdir).not.toHaveBeenCalled()
  })

  it('keeps the file when Music cannot be asked whether an entry plays it', async () => {
    const deps = intoMedia({
      addToAppleMusic: vi.fn(async () => {
        throw new Error('AppleEvent timed out (-1712)')
      }),
      appleMusicHoldsFile: vi.fn(async () => {
        throw new Error('Music file lookup failed')
      }),
    })

    await expect(runProcessTrack(musicJob(), deps)).rejects.toThrow('-1712')

    expect(deps.rm).not.toHaveBeenCalled()
  })

  // Music answering with the entry it already had holds nothing of the new file.
  it('removes the file when Music answers the add with the entry being replaced', async () => {
    const deps = intoMedia({ addToAppleMusic: vi.fn(async () => 'old-id') })

    await expect(
      runProcessTrack(
        musicJob({
          musicPersistentId: 'old-id',
          replacesPath: '/m/old.aiff',
          replacesLabel: 'A - T',
        }),
        deps,
      ),
    ).rejects.toThrow('appleMusicAddReturnedOld')

    expect(deps.rm).toHaveBeenCalledWith(filed, { recursive: false, force: true })
  })

  it('still reads where the entry points and lets the collections follow it', async () => {
    const redirectRepoint = vi.fn(() => true)
    const deps = intoMedia({ redirectRepoint })

    await runProcessTrack(
      musicJob({
        musicPersistentId: 'old-id',
        replacesPath: '/m/old.aiff',
        replacesLabel: 'A - T',
      }),
      deps,
    )

    expect(deps.appleMusicEntryLocation).toHaveBeenCalledWith('added-id')
    expect(redirectRepoint).toHaveBeenCalledWith(filed, filed)
  })

  it('keeps the temp dir when the Media folder cannot be read', async () => {
    const deps = intoMedia({ appleMusicMediaFolder: vi.fn(async () => undefined) })

    await runProcessTrack(musicJob(), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      '/tmp/surco-abc/Artist - Title.wav',
      meta,
      undefined,
    )
    expect(deps.rm).toHaveBeenCalledWith('/tmp/surco-abc', { recursive: true, force: true })
  })

  // An unmounted NAS: creating the path would write a stray /Volumes folder on the boot disk.
  it('keeps the temp dir when the Media folder is not there', async () => {
    const deps = intoMedia({ existsSync: vi.fn(() => false) })

    await runProcessTrack(musicJob(), deps)

    expect(deps.mkdtemp).toHaveBeenCalledOnce()
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      '/tmp/surco-abc/Artist - Title.wav',
      meta,
      undefined,
    )
  })

  it('keeps the temp dir rather than touch a file already at that place', async () => {
    const deps = intoMedia({ existsSync: vi.fn((p: string) => p === media || p === filed) })

    await runProcessTrack(musicJob(), deps)

    expect(deps.mkdtemp).toHaveBeenCalledOnce()
    expect(deps.rm).not.toHaveBeenCalledWith(filed, expect.anything())
  })

  it('keeps the temp dir when another job of the run already claimed that place', async () => {
    const deps = intoMedia({ isPathReserved: vi.fn((p: string) => p === filed) })

    await runProcessTrack(musicJob(), deps)

    expect(deps.mkdtemp).toHaveBeenCalledOnce()
    expect(deps.reservePath).not.toHaveBeenCalled()
  })
})

// Upgrading a library copy to a better format. Reported 14/09 after two failed attempts:
// the button offered "Sustituir por AIFF" and the library kept the MP3, because updating
// an entry only writes tags and can never repoint it at another file. A real replacement
// has to add the new file, carry the crates over and retire the old entry.
describe('runProcessTrack — replacing a library copy', () => {
  function replacing(overrides: Partial<ProcessTrackDeps> = {}): ProcessTrackDeps {
    return makeDeps({ platform: 'darwin', ...overrides })
  }

  const replaceJob = {
    addToAppleMusic: true,
    musicPersistentId: 'old-id',
    replacesPath: '/m/old.mp3',
    replacesLabel: 'Old Artist - Old Title',
  }

  // Measured from the user's log 15/09:
  //   repoint attempt: from="/Users/…/Soulseek Downloads/…/Transfer - Possession.flac"
  //   lookup miss: name="Transfer - Possession (Dececio Remix).flac" rows=0
  // The repoint searched for the file being CONVERTED instead of the one it supersedes,
  // because index.ts's convertAudio adapter declared its parameters only as far as
  // foreignRemoved and silently dropped the one after it. Nothing covered that wiring, so
  // a fully green suite said everything was fine while the collection was searched for a
  // download-folder FLAC it had never indexed. The path has to reach the conversion.
  it('hands the superseded path to the conversion', async () => {
    const convertAudio = vi.fn<ProcessTrackDeps['convertAudio']>(async () => ({
      normalizeSkipped: false,
      written,
    }))
    const deps = replacing({ convertAudio })

    await runProcessTrack(job(replaceJob), deps)

    expect(convertAudio.mock.calls[0]?.[13]).toBe('/m/old.mp3')
  })

  // The superseded copy lives in the user's library folder, which a conversion has no
  // other reason to authorise, and the shell guard rejects any path it was never handed.
  // Without this the offer to trash it would fail with "Ruta no permitida" — the kind of
  // silent refusal that already cost a day here.
  it('authorises the superseded file so it can be trashed', async () => {
    const deps = replacing()

    await runProcessTrack(job(replaceJob), deps)

    expect(deps.allowMedia).toHaveBeenCalledWith('/m/old.mp3')
  })

  // An ordinary conversion supersedes nothing, so it must not widen what the shell guard
  // will act on.
  it('authorises nothing extra when no copy was superseded', async () => {
    const deps = replacing()

    await runProcessTrack(job({ addToAppleMusic: true }), deps)

    expect(deps.allowMedia).toHaveBeenCalledTimes(1)
  })

  // The heart of it: the new file is imported rather than the old entry's tags rewritten.
  it('adds the converted file instead of only updating the old entry', async () => {
    const deps = replacing()

    await runProcessTrack(job(replaceJob), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalled()
    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
  })

  // Retiring the old entry is what leaves ONE copy in the library — the duplicate the
  // user reported. It happens last, so an add that fails destroys nothing.
  it('deletes the old entry once the new one carries its playlists', async () => {
    const deps = replacing()

    await runProcessTrack(job(replaceJob), deps)

    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('old-id', 'Old Artist - Old Title')
  })

  // Reported 01/10 with "Jamaican (Bam Bam)": the offered copy was "HUGEL, SOLTO (FR) -
  // Jamaican (Bam Bam) (Extended Mix)" and the conversion carried the matched tags "Hugel,
  // DJ Solto - Jamaican (Bam Bam) (Extended Version)". The candidate is chosen by a fuzzy
  // score, so the new tags almost never spell the old entry's name; checking the delete
  // against them refused it every time the user had improved the tags, which is exactly
  // when a replacement happens.
  it('verifies the old entry against its own name, not the tags just written', async () => {
    const deps = replacing()

    await runProcessTrack(
      job({
        ...replaceJob,
        meta: {
          artist: 'Hugel, DJ Solto',
          title: 'Jamaican (Bam Bam) (Extended Version)',
        } as TrackMetadata,
        replacesLabel: 'HUGEL, SOLTO (FR) - Jamaican (Bam Bam) (Extended Mix)',
      }),
      deps,
    )

    expect(deps.deleteAppleMusic).toHaveBeenCalledWith(
      'old-id',
      'HUGEL, SOLTO (FR) - Jamaican (Bam Bam) (Extended Mix)',
    )
  })

  // By the time the old entry is retired the file is converted and already in Music, so
  // failing the job reported "Couldn't convert" for a track sitting in the library. The
  // leftover duplicate is the only thing that went wrong, and that is what the user must
  // hear about.
  it('keeps the conversion when Music refuses to retire the old entry', async () => {
    const deps = replacing({
      deleteAppleMusic: vi.fn(async () => {
        throw new Error('applemusic-delete-mismatch')
      }),
    })

    const result = await runProcessTrack(job(replaceJob), deps)

    expect(result.musicPersistentId).toBe('added-id')
    expect(result.oldMusicCopyKept).toBe('mismatch')
  })

  it('tells a refused delete apart from one that failed', async () => {
    const deps = replacing({
      deleteAppleMusic: vi.fn(async () => {
        throw new Error('osascript timed out')
      }),
    })

    const result = await runProcessTrack(job(replaceJob), deps)

    expect(result.oldMusicCopyKept).toBe('error')
  })

  // The delete takes the old entry's normal playlists, play count, rating and favorite with
  // it, and a DJ's hand-made crates are exactly what must survive swapping an MP3 for its
  // AIFF. The copy has to land on the entry just added, checked against the old one's own
  // name like the delete.
  it('replacing keeps the track in its normal playlists and keeps its play count and rating', async () => {
    const deps = replacing()

    await runProcessTrack(job(replaceJob), deps)

    expect(deps.carryAppleMusicHistory).toHaveBeenCalledWith(
      'old-id',
      'added-id',
      'Old Artist - Old Title',
    )
  })

  // Deleting after a failed copy would lose the playlists the copy did not reach. Keeping
  // the old entry leaves two copies in Music and nothing lost, and the DJ is told.
  it('keeps the old entry and says so when its playlists could not be carried over', async () => {
    const deps = replacing({
      carryAppleMusicHistory: vi.fn(async () => {
        throw new Error('Music got an error: -54')
      }),
    })

    const result = await runProcessTrack(job(replaceJob), deps)

    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.musicPersistentId).toBe('added-id')
    expect(result.oldMusicCopyKept).toBe('carry')
  })

  it('keeps the old entry when it no longer carries the name the DJ confirmed', async () => {
    const deps = replacing({ carryAppleMusicHistory: vi.fn(async () => 'mismatch' as const) })

    const result = await runProcessTrack(job(replaceJob), deps)

    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.oldMusicCopyKept).toBe('mismatch')
  })

  it('reports nothing kept when the old entry was retired', async () => {
    const result = await runProcessTrack(job(replaceJob), replacing())

    expect(result.oldMusicCopyKept).toBeUndefined()
  })

  // Order is the safety property: if the delete ran first, a failing add would lose the
  // track from the library entirely, with the playlists already gone.
  it('adds before it deletes', async () => {
    const calls: string[] = []
    const deps = replacing({
      addToAppleMusic: vi.fn(async () => {
        calls.push('add')
        return 'added-id'
      }),
      carryAppleMusicHistory: vi.fn(async () => {
        calls.push('carry')
        return 'carried' as const
      }),
      deleteAppleMusic: vi.fn(async () => {
        calls.push('delete')
      }),
    })

    await runProcessTrack(job(replaceJob), deps)

    expect(calls).toEqual(['add', 'carry', 'delete'])
  })

  // Measured from the user's own log 15/09, after three runs that reported only
  // "1 skipped": the flush refused with output-missing on a /var/folders/…/surco-… path.
  // With Apple Music as the destination the conversion writes to a private temp dir and
  // Music copies the file into its Media folder, so the path recorded during the
  // conversion is deleted before the flush runs. Only this step learns where the file
  // really landed, so it has to correct the entry — otherwise the collection silently
  // stays on the old MP3 while the app reports success.
  it('points the collection at where Music put the file, not the temp copy', async () => {
    const redirectRepoint = vi.fn()
    const deps = replacing({
      settings: settings({ keepOutputCopy: false }),
      mkdtemp: vi.fn(async () => '/tmp/surco-abc'),
      appleMusicEntryLocation: vi.fn(async () => '/Media/Transfer - Possession.aiff'),
      redirectRepoint,
    })

    await runProcessTrack(job({ ...replaceJob, keepOutputCopy: false }), deps)

    expect(redirectRepoint).toHaveBeenCalledWith(
      '/tmp/surco-abc/Artist - Title.aiff',
      '/Media/Transfer - Possession.aiff',
    )
  })

  // A conversion that keeps its own copy wrote the file where it will stay, so the
  // recorded path is already right and must not be rewritten.
  it('leaves the recorded path alone when the file was not handed over from a temp copy', async () => {
    const redirectRepoint = vi.fn()
    const deps = replacing({ redirectRepoint })

    await runProcessTrack(job(replaceJob), deps)

    expect(redirectRepoint).not.toHaveBeenCalled()
  })

  // Without replacesPath the id still means "my own earlier output": re-converting an
  // edited track syncs that copy and must never import a second one.
  it('still syncs in place when no file is being superseded', async () => {
    const deps = replacing()

    await runProcessTrack(job({ addToAppleMusic: true, musicPersistentId: 'old-id' }), deps)

    expect(deps.updateInAppleMusic).toHaveBeenCalled()
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
  })
})

// Measured 30/10 on the user's library: Music answers an `add` whose name, artist and album
// match an entry it already has with THAT entry, importing nothing, even when the new file is
// another format. A WAV converted to AIFF came back with the WAV's own ID, the history was
// carried onto itself and the delete took the track out of Music. The old entry is renamed
// for the length of the add, and an add that still answers with it touches nothing.
describe('runProcessTrack — Music answering an add with the entry it already has', () => {
  const replaceJob = job({
    meta: { artist: 'Artist', title: 'Title' } as TrackMetadata,
    addToAppleMusic: true,
    musicPersistentId: 'old-id',
    replacesPath: '/m/old.wav',
    replacesLabel: 'Artist - Title',
  })
  const calls: string[] = []
  function recording(overrides: Partial<ProcessTrackDeps> = {}): ProcessTrackDeps {
    calls.length = 0
    return makeDeps({
      platform: 'darwin',
      markAppleMusicReplacing: vi.fn(async (pid: string, _label: string, marked: boolean) => {
        calls.push(`${marked ? 'mark' : 'unmark'} ${pid}`)
        return 'set' as const
      }),
      addToAppleMusic: vi.fn(async () => {
        calls.push('add')
        return 'added-id'
      }),
      carryAppleMusicHistory: vi.fn(async () => {
        calls.push('carry')
        return 'carried' as const
      }),
      deleteAppleMusic: vi.fn(async (pid: string) => {
        calls.push(`delete ${pid}`)
      }),
      ...overrides,
    })
  }

  it('renames the old entry for the add and restores it before carrying anything over', async () => {
    const deps = recording()

    const result = await runProcessTrack(replaceJob, deps)

    expect(calls).toEqual(['mark old-id', 'add', 'unmark old-id', 'carry', 'delete old-id'])
    expect(deps.markAppleMusicReplacing).toHaveBeenCalledWith('old-id', 'Artist - Title', true)
    expect(deps.markAppleMusicReplacing).toHaveBeenCalledWith('old-id', 'Artist - Title', false)
    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      '/out/Artist - Title.aiff',
      replaceJob.meta,
      undefined,
    )
    expect(deps.carryAppleMusicHistory).toHaveBeenCalledWith('old-id', 'added-id', 'Artist - Title')
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('old-id', 'Artist - Title')
    expect(result.musicPersistentId).toBe('added-id')
  })

  it('touches nothing and fails the Music step when the add still answers with the old entry', async () => {
    const deps = recording({
      addToAppleMusic: vi.fn(async () => {
        calls.push('add')
        return 'old-id'
      }),
    })

    const result = await runProcessTrack(replaceJob, deps)

    expect(calls).toEqual(['mark old-id', 'add', 'unmark old-id'])
    expect(deps.carryAppleMusicHistory).not.toHaveBeenCalled()
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.appleMusicFailed).toBe(true)
    expect(result.musicPersistentId).toBeUndefined()
    expect(result.supersededPath).toBeUndefined()
  })

  // In "Apple Music only" the copy check would roll back the entry the add answered with,
  // which is the old one: the same loss through another door.
  it('fails "Apple Music only" out loud without rolling back the old entry', async () => {
    const deps = recording({
      settings: settings({ keepOutputCopy: false }),
      addToAppleMusic: vi.fn(async () => {
        calls.push('add')
        return 'old-id'
      }),
    })

    const failure = await runProcessTrack({ ...replaceJob, keepOutputCopy: false }, deps).catch(
      (e: Error) => e,
    )

    expect(errorKeyOf((failure as Error).message)).toBe('appleMusicAddReturnedOld')
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(deps.carryAppleMusicHistory).not.toHaveBeenCalled()
    expect(calls).toContain('unmark old-id')
  })

  it('restores the old name when the add fails', async () => {
    const deps = recording({
      addToAppleMusic: vi.fn(async () => {
        calls.push('add')
        throw new Error('Music got an error: -2753')
      }),
    })

    const result = await runProcessTrack(replaceJob, deps)

    expect(calls).toEqual(['mark old-id', 'add', 'unmark old-id'])
    expect(result.appleMusicFailed).toBe(true)
  })

  it('restores the old name when the new entry is rolled back for pointing at the temp file', async () => {
    const deps = recording({
      settings: settings({ keepOutputCopy: false }),
      appleMusicEntryLocation: vi.fn(async () => '/tmp/surco-abc/Artist - Title.aiff'),
    })

    await expect(runProcessTrack({ ...replaceJob, keepOutputCopy: false }, deps)).rejects.toThrow(
      'appleMusicNoMediaCopyKept',
    )

    expect(calls).toEqual(['mark old-id', 'add', 'delete added-id', 'unmark old-id'])
  })

  it('keeps the old entry under its own name when its history could not be carried', async () => {
    const deps = recording({
      carryAppleMusicHistory: vi.fn(async () => {
        calls.push('carry')
        throw new Error('Music got an error: -54')
      }),
    })

    const result = await runProcessTrack(replaceJob, deps)

    expect(calls).toEqual(['mark old-id', 'add', 'unmark old-id', 'carry'])
    expect(result.oldMusicCopyKept).toBe('carry')
  })

  // The renderer runs a batch's conversions in parallel and Music only serializes single
  // scripts: a second job's add landing between this one's rename and its restore is the
  // window where Music hands back a copy that is not the one being replaced.
  it('runs one replacement at a time so two jobs cannot interleave rename, add and delete', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const deps = recording({
      addToAppleMusic: vi.fn(async (file: string) => {
        calls.push(`add ${file}`)
        if (file.includes('One')) await gate
        return file.includes('One') ? 'new-1' : 'new-2'
      }),
    })
    const replaceOf = (id: string, name: string, pid: string) =>
      runProcessTrack(
        job({
          id,
          outputName: name,
          meta: { artist: 'A', title: name } as TrackMetadata,
          addToAppleMusic: true,
          musicPersistentId: pid,
          replacesPath: `/m/${name}.wav`,
          replacesLabel: `A - ${name}`,
        }),
        deps,
      )

    const one = replaceOf('a', 'One', 'old-1')
    const two = replaceOf('b', 'Two', 'old-2')
    await vi.waitFor(() => expect(calls).toContain('add /out/One.aiff'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).not.toContain('mark old-2')
    release()
    await Promise.all([one, two])

    expect(calls.indexOf('delete old-1')).toBeLessThan(calls.indexOf('mark old-2'))
  })

  // Every add refuses an answer that was already in the library (appleMusic.ts), the plain
  // add included: verified against that entry's own file, it reported success while the
  // collections were redirected to the old file.
  it('fails "Apple Music only" when a plain add is answered with an entry already there', async () => {
    const redirectRepoint = vi.fn(() => true)
    const deps = recording({
      settings: settings({ keepOutputCopy: false }),
      redirectRepoint,
      addToAppleMusic: vi.fn(async () => {
        throw errorWithKey('appleMusicAddReturnedOld', '/tmp/x')
      }),
    })

    await expect(
      runProcessTrack(
        job({ meta: replaceJob.meta, addToAppleMusic: true, keepOutputCopy: false }),
        deps,
      ),
    ).rejects.toThrow('appleMusicAddReturnedOld')

    expect(redirectRepoint).not.toHaveBeenCalled()
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
  })

  it('reports the Music step failed when a plain add with an output copy is answered with an entry already there', async () => {
    const deps = recording({
      addToAppleMusic: vi.fn(async () => {
        throw errorWithKey('appleMusicAddReturnedOld', '/out/x')
      }),
    })

    const result = await runProcessTrack(
      job({ meta: replaceJob.meta, addToAppleMusic: true }),
      deps,
    )

    expect(result.appleMusicFailed).toBe(true)
    expect(result.musicPersistentId).toBeUndefined()
  })

  // The rename can land in Music and the script still fail on the way back (a timeout):
  // the restore is label-guarded, so asking for it is harmless when nothing was renamed.
  it('still restores the name when the rename itself failed', async () => {
    const deps = recording({
      markAppleMusicReplacing: vi.fn(async (pid: string, _label: string, marked: boolean) => {
        calls.push(`${marked ? 'mark' : 'unmark'} ${pid}`)
        if (marked) throw new Error('AppleEvent timed out (-1712)')
        return 'set' as const
      }),
    })

    const result = await runProcessTrack(replaceJob, deps)

    expect(calls).toEqual(['mark old-id', 'unmark old-id'])
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(result.appleMusicFailed).toBe(true)
  })

  // A restore Music refused leaves " [surco-replacing]" at the end of a name in the DJ's
  // library, and only the DJ can take it off: it has to be said, not only logged.
  const restoreRefused = () =>
    vi.fn(async (pid: string, _label: string, marked: boolean) => {
      calls.push(`${marked ? 'mark' : 'unmark'} ${pid}`)
      if (!marked) throw new Error('AppleEvent timed out (-1712)')
      return 'set' as const
    })

  it('reports a name it could not restore after a replacement', async () => {
    const result = await runProcessTrack(
      replaceJob,
      recording({ markAppleMusicReplacing: restoreRefused() }),
    )

    expect(result.musicNameLeftMarked).toBe(true)
  })

  it('reports a name it could not restore when the replacement failed', async () => {
    const deps = recording({
      markAppleMusicReplacing: restoreRefused(),
      addToAppleMusic: vi.fn(async () => {
        throw new Error('Music got an error: -2753')
      }),
    })

    const result = await runProcessTrack(replaceJob, deps)

    expect(result.appleMusicFailed).toBe(true)
    expect(result.musicNameLeftMarked).toBe(true)
  })

  // The cause is what the DJ can act on; the leftover mark rides along so the renderer can
  // say it too, without the failure losing its own message or key.
  it('fails "Apple Music only" with the real cause, carrying the name it could not restore', async () => {
    const deps = recording({
      settings: settings({ keepOutputCopy: false }),
      markAppleMusicReplacing: restoreRefused(),
      addToAppleMusic: vi.fn(async () => {
        throw new Error('Music got an error: -2753')
      }),
    })

    const failure = await runProcessTrack({ ...replaceJob, keepOutputCopy: false }, deps).catch(
      (e: Error) => e,
    )

    expect((failure as Error).message).toContain('Music got an error: -2753')
    expect(splitNameLeftMarked((failure as Error).message)).toEqual({
      message: 'Music got an error: -2753',
      left: true,
    })
  })

  it('keeps a translatable cause readable when the name was left marked', async () => {
    const deps = recording({
      settings: settings({ keepOutputCopy: false }),
      markAppleMusicReplacing: restoreRefused(),
      addToAppleMusic: vi.fn(async () => {
        throw errorWithKey('appleMusicAddReturnedOld', '/tmp/x')
      }),
    })

    const failure = await runProcessTrack({ ...replaceJob, keepOutputCopy: false }, deps).catch(
      (e: Error) => e,
    )

    expect(errorKeyOf((failure as Error).message)).toBe('appleMusicAddReturnedOld')
    expect(splitNameLeftMarked((failure as Error).message).left).toBe(true)
  })

  it('reports nothing when the name came back', async () => {
    const result = await runProcessTrack(replaceJob, recording())

    expect(result.musicNameLeftMarked).toBeUndefined()
  })

  // An entry that no longer carries the confirmed name is not renamed, so there is nothing to
  // restore; the add still runs and the label checks after it decide as before.
  it('restores nothing it did not rename', async () => {
    const deps = recording({
      markAppleMusicReplacing: vi.fn(async (pid: string, _label: string, marked: boolean) => {
        calls.push(`${marked ? 'mark' : 'unmark'} ${pid}`)
        return 'mismatch' as const
      }),
    })

    await runProcessTrack(replaceJob, deps)

    expect(calls).toEqual(['mark old-id', 'add', 'carry', 'delete old-id'])
  })
})

describe('runProcessTrack: file names without accents', () => {
  it('writes the plain spelling when the setting is on, so a NAS search for "royksopp" finds it', async () => {
    const deps = makeDeps({ settings: settings({ asciiFileNames: true }) })
    const result = await runProcessTrack(job({ outputName: 'Röyksopp - Fiësta' }), deps)
    expect(result.outputPath).toBe('/out/Royksopp - Fiesta.aiff')
  })

  // The source's own name only stands for the folder it lives in: the output folder can be
  // the very disk that fails with accents, which is why the setting exists.
  it('folds a name into the output folder even when the source already carries it', async () => {
    const deps = makeDeps({ settings: settings({ asciiFileNames: true }) })
    const result = await runProcessTrack(
      job({ inputPath: '/in/Röyksopp - Fiësta.wav', outputName: 'Röyksopp - Fiësta' }),
      deps,
    )
    expect(result.outputPath).toBe('/out/Royksopp - Fiesta.aiff')

    const beside = makeDeps({
      settings: settings({ asciiFileNames: true, convertBesideOriginal: true }),
    })
    const besideResult = await runProcessTrack(
      job({ inputPath: '/in/Röyksopp - Fiësta.wav', outputName: 'Röyksopp - Fiësta' }),
      beside,
    )
    expect(besideResult.outputPath).toBe('/in/Royksopp - Fiesta.aiff')
  })

  it('keeps the accents by default, since most users want the name exactly as tagged', async () => {
    const result = await runProcessTrack(job({ outputName: 'Röyksopp - Fiësta' }), makeDeps())
    expect(result.outputPath).toBe('/out/Röyksopp - Fiësta.aiff')
  })
})

describe('runProcessTrack: accented file names on macOS', () => {
  it('lands on the NFD spelling the source already has, since an SMB NAS treats the NFC one as a different file it refuses to overwrite', async () => {
    const inputPath = '/Volumes/NAS/Junkie XL - Breezer (Tiësto Remix).mp3'.normalize('NFD')
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ overwriteOriginal: true }),
      existsSync: vi.fn(() => true),
      isSameFile: vi.fn(async (a: string, b: string) => a === b),
    })
    const result = await runProcessTrack(
      job({
        inputPath,
        format: 'mp3',
        outputName: 'Junkie XL - Breezer (Tiësto Remix)'.normalize('NFC'),
      }),
      deps,
    )
    expect(result.outputPath).toBe(inputPath)
    expect(deps.confirmConflict).not.toHaveBeenCalled()
  })

  it('writes a new accented name in NFD, the form Finder writes and the NAS can find again', async () => {
    const result = await runProcessTrack(
      job({ outputName: 'Röyksopp - Fiësta'.normalize('NFC') }),
      makeDeps({ platform: 'darwin' }),
    )
    expect(result.outputPath).toBe('/out/Röyksopp - Fiësta.aiff'.normalize('NFD'))
  })

  it('keeps NFC elsewhere, since Windows volumes compare names byte for byte and tag-derived names are NFC', async () => {
    const result = await runProcessTrack(
      job({ outputName: 'Röyksopp - Fiësta'.normalize('NFC') }),
      makeDeps({ platform: 'win32' }),
    )
    expect(result.outputPath).toBe('/out/Röyksopp - Fiësta.aiff'.normalize('NFC'))
  })
})

describe('progress for a window that closed mid-job', () => {
  it('is not sent to a destroyed window, so the steps after the write still run', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const wiring = source.match(/sendProgress: \(stage\) =>[^\n]*(\n[^\n]*){0,2}/)?.[0] ?? ''
    expect(wiring).toContain('e.sender.isDestroyed()')
  })
})

// Measured 30/10 on the user's library: an AIFF opened from the Music tab and converted to
// WAV with "Apple Music only" only re-tagged the AIFF entry, deleted the WAV and still said
// it was added. Music can't repoint an entry at another file, so a format change has to
// import the new file and retire the old entry; a same-format re-sync stays an update.
describe('runProcessTrack — converting a library track to another format', () => {
  function converting(entry: string, overrides: Partial<ProcessTrackDeps> = {}) {
    return makeDeps({
      platform: 'darwin',
      appleMusicEntry: vi.fn(async () => ({ path: entry, label: 'Old Artist - Old Title' })),
      appleMusicEntryLocation: vi.fn(async () => '/Users/me/Music/Media/new.wav'),
      ...overrides,
    })
  }

  const libraryJob = (over: Partial<ProcessJob> = {}) =>
    job({
      inputPath: '/lib/A.aiff',
      format: 'wav',
      musicPersistentId: 'PID',
      addToAppleMusic: true,
      keepOutputCopy: false,
      ...over,
    })

  it('replaces the AIFF entry with the WAV in "Apple Music only" and offers the AIFF for trash', async () => {
    const deps = converting('/lib/A.aiff')

    const result = await runProcessTrack(libraryJob(), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      '/tmp/surco-abc/Artist - Title.wav',
      {},
      undefined,
    )
    expect(deps.carryAppleMusicHistory).toHaveBeenCalledWith('PID', 'added-id', expect.any(String))
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('PID', expect.any(String))
    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
    expect(deps.allowMedia).toHaveBeenCalledWith('/lib/A.aiff')
    expect(result).toMatchObject({ musicPersistentId: 'added-id', supersededPath: '/lib/A.aiff' })
  })

  it('replaces the entry the same way when the WAV is also kept in the output folder', async () => {
    const deps = converting('/lib/A.aiff')

    const result = await runProcessTrack(libraryJob({ keepOutputCopy: true }), deps)

    expect(deps.addToAppleMusic).toHaveBeenCalledWith('/out/Artist - Title.wav', {}, undefined)
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('PID', expect.any(String))
    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      outputPath: '/out/Artist - Title.wav',
      musicPersistentId: 'added-id',
      supersededPath: '/lib/A.aiff',
    })
  })

  it('replaces a WAV entry converted to AIFF', async () => {
    const deps = converting('/lib/A.wav')

    const result = await runProcessTrack(
      libraryJob({ inputPath: '/lib/A.wav', format: 'aiff' }),
      deps,
    )

    expect(deps.addToAppleMusic).toHaveBeenCalledWith(
      '/tmp/surco-abc/Artist - Title.aiff',
      {},
      undefined,
    )
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('PID', expect.any(String))
    expect(result.supersededPath).toBe('/lib/A.wav')
  })

  // The temp file in "Apple Music only", or Music's own Media copy of an earlier add, is
  // never the file the entry points at: comparing paths would churn every re-sync.
  it('only updates the entry when the format stays the same, even though the file written is another one', async () => {
    const deps = converting('/Users/me/Music/Media/A.aiff')

    const result = await runProcessTrack(libraryJob({ format: 'aiff' }), deps)

    expect(deps.updateInAppleMusic).toHaveBeenCalledWith('PID', {}, undefined)
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.supersededPath).toBeUndefined()
  })

  it('falls back to updating the entry when it no longer exists in Music', async () => {
    const deps = converting('')

    const result = await runProcessTrack(libraryJob({ keepOutputCopy: true }), deps)

    expect(deps.updateInAppleMusic).toHaveBeenCalledWith('PID', {}, undefined)
    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.musicPersistentId).toBe('updated-id')
    expect(result.supersededPath).toBeUndefined()
  })

  // A read that fails is not an entry that is gone: falling back to the update re-tagged the
  // AIFF, discarded the WAV and still reported the track added, the bug this replaces.
  it('fails the Apple Music step when Music cannot be asked where the entry points', async () => {
    const deps = converting('', {
      appleMusicEntry: vi.fn(async () => {
        throw new Error('AppleEvent timed out (-1712)')
      }),
    })

    const result = await runProcessTrack(libraryJob({ keepOutputCopy: true }), deps)

    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(result.appleMusicFailed).toBe(true)
    expect(result.musicPersistentId).toBeUndefined()
  })

  it('fails the job in "Apple Music only" when Music cannot be asked where the entry points', async () => {
    const deps = converting('', {
      appleMusicEntry: vi.fn(async () => {
        throw new Error('AppleEvent timed out (-1712)')
      }),
    })

    await expect(runProcessTrack(libraryJob(), deps)).rejects.toThrow('-1712')
    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
  })

  // The row was the AIFF Music played; once the entry is the WAV Music copied, the row has
  // to follow it, or trashing the AIFF leaves a dead row and the next conversion repoints
  // rekordbox from a file it no longer indexes.
  it('moves the row to the file Music landed when the superseded file was its own source', async () => {
    const deps = converting('/lib/A.aiff')

    const result = await runProcessTrack(libraryJob(), deps)

    expect(result.musicLandedPath).toBe('/Users/me/Music/Media/new.wav')
    expect(deps.allowMedia).toHaveBeenCalledWith('/Users/me/Music/Media/new.wav')
  })

  it('leaves the row on its source when Music replaced a copy of another file', async () => {
    const deps = converting('/Users/me/Music/Media/A.aiff')

    const result = await runProcessTrack(libraryJob(), deps)

    expect(result.supersededPath).toBe('/Users/me/Music/Media/A.aiff')
    expect(result.musicLandedPath).toBeUndefined()
  })

  // Measured on 30/10: Music rewrites an entry's file the moment a tag is set on it. The
  // entry the job knows may play a file of the DJ's this conversion never wrote.
  it('backs up the file an updated entry plays before Music retags it', async () => {
    const deps = converting('/lib/A.aiff')
    const keeper = vi.fn(async () => null)
    configureOriginalKeeper(keeper)
    try {
      await runProcessTrack(
        libraryJob({ inputPath: '/lib/A.wav', format: 'aiff', keepOutputCopy: true }),
        deps,
      )
    } finally {
      configureOriginalKeeper(null)
    }

    expect(keeper).toHaveBeenCalledWith('/lib/A.aiff', 'replaced', '/lib/A.aiff', {
      reencodes: false,
      staysInPlace: true,
    })
    expect(keeper.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.updateInAppleMusic).mock.invocationCallOrder[0],
    )
  })

  it('leaves Music alone and names why when that backup has no room', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-pt-'))
    const entryFile = join(dir, 'A.aiff')
    writeFileSync(entryFile, 'audio')
    const deps = converting(entryFile)
    configureOriginalKeeper(
      policyKeeper(
        () => 'always',
        async () => null,
      ),
    )
    let result: Awaited<ReturnType<typeof runProcessTrack>>
    try {
      result = await runProcessTrack(
        libraryJob({ inputPath: '/lib/A.wav', format: 'aiff', keepOutputCopy: true }),
        deps,
      )
    } finally {
      configureOriginalKeeper(null)
    }

    expect(deps.updateInAppleMusic).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      appleMusicFailed: true,
      appleMusicErrorKey: 'noRoomBeforeMusicRewrite',
    })
  })

  it('drops that backup when the entry turned out gone and Music touched nothing', async () => {
    const deps = converting('/lib/A.aiff', { updateInAppleMusic: vi.fn(async () => null) })
    const kept = { id: 'kept' } as TrashEntry
    const discarded = vi.fn(async () => {})
    configureOriginalKeeper(vi.fn(async () => kept))
    configureBackupDiscarder(discarded)
    try {
      await runProcessTrack(
        libraryJob({ inputPath: '/lib/A.wav', format: 'aiff', keepOutputCopy: true }),
        deps,
      )
    } finally {
      configureOriginalKeeper(null)
      configureBackupDiscarder(null)
    }

    expect(discarded).toHaveBeenCalledWith(kept)
  })

  // Retired after the Music step, the original went to Originals as Music had rewritten
  // it. The copy is taken before Music, and the retirement only removes the file.
  it('keeps the renamed original as it was before Music retagged it', async () => {
    const deps = converting('/lib/A.aiff')
    const keeper = vi.fn(async () => ({ id: 'kept' }) as TrashEntry)
    configureOriginalKeeper(keeper)
    try {
      await runProcessTrack(
        libraryJob({ format: 'aiff', overwriteOriginal: true, keepOutputCopy: true }),
        deps,
      )
    } finally {
      configureOriginalKeeper(null)
    }

    expect(keeper).toHaveBeenCalledWith('/lib/A.aiff', 'replaced', '/lib/Artist - Title.aiff', {
      staysInPlace: true,
    })
    expect(keeper.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.updateInAppleMusic).mock.invocationCallOrder[0],
    )
    expect(deps.removeRenamedOriginal).toHaveBeenCalledWith(
      '/lib/A.aiff',
      '/lib/Artist - Title.aiff',
      true,
    )
  })

  // The in-place rename already retired the AIFF: offering it again would trash nothing.
  it('offers nothing for trash when the conversion overwrote the original in place', async () => {
    const deps = converting('/lib/A.aiff')

    const result = await runProcessTrack(
      libraryJob({ overwriteOriginal: true, keepOutputCopy: true }),
      deps,
    )

    expect(result.inPlace).toBe(true)
    expect(deps.removeRenamedOriginal).toHaveBeenCalled()
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('PID', expect.any(String))
    expect(result.supersededPath).toBeUndefined()
  })

  // The entry plays the original until it is replaced: retired first, a replacement that
  // failed or kept the old entry left that entry playing a file that was gone.
  it('retires the in-place original only after its Music entry was replaced', async () => {
    const deps = converting('/lib/A.aiff')

    await runProcessTrack(libraryJob({ overwriteOriginal: true, keepOutputCopy: true }), deps)

    expect(vi.mocked(deps.removeRenamedOriginal).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(deps.deleteAppleMusic).mock.invocationCallOrder[0],
    )
  })

  it('keeps the in-place original when the old entry had to be kept', async () => {
    const deps = converting('/lib/A.aiff', {
      carryAppleMusicHistory: vi.fn(async () => 'mismatch' as const),
    })

    const result = await runProcessTrack(
      libraryJob({ overwriteOriginal: true, keepOutputCopy: true }),
      deps,
    )

    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(result.originalKept).toBe(true)
    expect(result.supersededPath).toBeUndefined()
  })

  it('keeps the in-place original when Music could not be asked about its entry', async () => {
    const deps = converting('/lib/A.aiff', {
      appleMusicEntry: vi.fn(async () => {
        throw new Error('AppleEvent timed out (-1712)')
      }),
    })

    const result = await runProcessTrack(
      libraryJob({ overwriteOriginal: true, keepOutputCopy: true }),
      deps,
    )

    expect(deps.removeRenamedOriginal).not.toHaveBeenCalled()
    expect(result.appleMusicFailed).toBe(true)
    expect(result.originalKept).toBe(true)
  })

  // A retire that fails on its own (a Windows lock) after a good replacement still leaves
  // the old file to offer, as before.
  it('offers the in-place original when the replacement worked but retiring it failed', async () => {
    const deps = converting('/lib/A.aiff', {
      removeRenamedOriginal: vi.fn(async () => {
        throw new Error('EBUSY')
      }),
    })

    const result = await runProcessTrack(
      libraryJob({ overwriteOriginal: true, keepOutputCopy: true }),
      deps,
    )

    expect(result.originalKept).toBe(true)
    expect(result.supersededPath).toBe('/lib/A.aiff')
  })

  // Traktor rewrites FILE only, so a WAV Music landed in another folder leaves its entry
  // on the AIFF: trashing that would drop the track from Traktor.
  it('keeps the old file out of the trash offer when Traktor could not follow the landed file', async () => {
    const deps = converting('/lib/A.aiff', { redirectRepoint: vi.fn(() => false) })

    const result = await runProcessTrack(libraryJob(), deps)

    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('PID', expect.any(String))
    expect(result.supersededPath).toBeUndefined()
    expect(deps.allowMedia).not.toHaveBeenCalledWith('/lib/A.aiff')
  })

  it('offers the old file when Traktor followed the landed file', async () => {
    const deps = converting('/lib/A.aiff', { redirectRepoint: vi.fn(() => true) })

    const result = await runProcessTrack(libraryJob(), deps)

    expect(result.supersededPath).toBe('/lib/A.aiff')
  })

  // The batch this was measured for is auto-matched AIFFs: the job's tags are the match,
  // not what Music shows, and the delete only retires an entry whose live name it is told.
  it('retires the entry under the name Music shows, not the edited tags the job carries', async () => {
    const deps = converting('/lib/A.aiff')

    const result = await runProcessTrack(
      libraryJob({ meta: { artist: 'New Artist', title: 'New Title' } as TrackMetadata }),
      deps,
    )

    expect(deps.appleMusicEntry).toHaveBeenCalledWith('PID')
    expect(deps.carryAppleMusicHistory).toHaveBeenCalledWith(
      'PID',
      'added-id',
      'Old Artist - Old Title',
    )
    expect(deps.deleteAppleMusic).toHaveBeenCalledWith('PID', 'Old Artist - Old Title')
    expect(result.oldMusicCopyKept).toBeUndefined()
    expect(result.supersededPath).toBe('/lib/A.aiff')
  })

  it('offers nothing for trash when the old entry had to be kept', async () => {
    const deps = converting('/lib/A.aiff', {
      carryAppleMusicHistory: vi.fn(async () => 'mismatch' as const),
    })

    const result = await runProcessTrack(libraryJob(), deps)

    expect(deps.deleteAppleMusic).not.toHaveBeenCalled()
    expect(result.oldMusicCopyKept).toBe('mismatch')
    expect(result.supersededPath).toBeUndefined()
    expect(deps.allowMedia).not.toHaveBeenCalledWith('/lib/A.aiff')
  })
})

describe('runProcessTrack — checking what it wrote', () => {
  const snapshot = { id: '7', cues: 3, analysisDataPath: '/a.DAT', analysed: 105 }
  const engineSnapshot = { id: 9, quickCues: 'q', beatData: 'b', loops: 'l' }
  const meta = { title: 'Title', artist: 'Artist', album: 'Album' } as TrackMetadata
  const musicOk: PlaceCheck = {
    place: 'appleMusic',
    state: 'ok',
    detail: { key: 'musicOneNoPlaylists' },
  }

  it('a finished job returns verification with the file check and libraries checking', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      settings: settings({ syncTraktor: true, traktorNmlPath: '/t/collection.nml' }),
      snapshotLibraries: vi.fn<NonNullable<ProcessTrackDeps['snapshotLibraries']>>(async () => ({
        rekordbox: snapshot,
        engine: engineSnapshot,
      })),
      registerVerification,
    })

    const result = await runProcessTrack(job({ meta, removeCover: true }), deps)

    expect(deps.verifyFile).toHaveBeenCalledWith(
      {
        path: '/out/Artist - Title.aiff',
        ext: '.aiff',
        codec: 'pcm_s16be',
        bitDepth: 16,
        samplesKept: false,
        sourceDurationSec: 2,
        trimmedSec: 0,
        tags: meta,
        cover: 'removed',
      },
      expect.any(AbortSignal),
    )
    const checking = (place: PlaceCheck['place']) => ({
      place,
      state: 'checking',
      detail: { key: 'checking' },
    })
    expect(result.verification).toEqual({
      status: 'checking',
      checks: [fileOk, checking('rekordbox'), checking('engine'), checking('traktor')],
      job: expect.any(String),
      seq: 0,
    })
    expect(registerVerification).toHaveBeenCalledOnce()
    const entry = registerVerification.mock.calls[0][0]
    expect(entry).toMatchObject({
      trackId: 'job1',
      from: '/in/song.wav',
      source: '/in/song.wav',
      to: '/out/Artist - Title.aiff',
      samplesKept: false,
      originalKept: false,
      rekordbox: snapshot,
      engine: engineSnapshot,
      verification: result.verification,
    })
    expect([...entry.places]).toEqual(['file', 'rekordbox', 'engine', 'traktor'])
    expect(entry.music).toBeUndefined()
  })

  // A source no library has was never touched there: listing it would leave a place
  // "checking" that nothing will ever answer for. One that could not be read is kept,
  // or a locked database would pass for a track the library does not have.
  it('lists a library only when the source was there or could not be told apart', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      snapshotLibraries: vi.fn<NonNullable<ProcessTrackDeps['snapshotLibraries']>>(async () => ({
        rekordbox: 'absent',
        engine: 'unreadable',
      })),
      registerVerification,
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification?.checks.map((c) => c.place)).toEqual(['file', 'engine'])
    expect(registerVerification.mock.calls[0][0].rekordbox).toBe('absent')
    expect(registerVerification.mock.calls[0][0].engine).toBe('unreadable')
  })

  // The renderer keeps an update only for the conversion it holds and only when newer than
  // the result: converting the same track again must not inherit the last one's count.
  it('each conversion names its own job and starts its count at 0', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({ registerVerification })

    const first = await runProcessTrack(job(), deps)
    const second = await runProcessTrack(job(), deps)

    expect(first.verification?.seq).toBe(0)
    expect(second.verification?.seq).toBe(0)
    expect(first.verification?.job).toEqual(expect.any(String))
    expect(second.verification?.job).toEqual(expect.any(String))
    expect(second.verification?.job).not.toBe(first.verification?.job)
    expect(registerVerification.mock.calls[1][0].verification.job).toBe(second.verification?.job)
  })

  it('the success result carries the file mismatch instead of throwing', async () => {
    const missing: PlaceCheck = { place: 'file', state: 'mismatch', detail: { key: 'fileMissing' } }
    const deps = makeDeps({ verifyFile: vi.fn(async () => missing) })

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
    expect(result.verification).toEqual({
      status: 'mismatch',
      checks: [missing],
      job: expect.any(String),
      seq: 0,
    })
  })

  // The file is written by then: a reader that throws only means it could not be read.
  it('a check that throws reads as unreadable and the job still succeeds', async () => {
    const deps = makeDeps({
      verifyFile: vi.fn(async () => {
        throw new Error('ffprobe exited 1')
      }),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification).toEqual({
      status: 'mismatch',
      checks: [{ place: 'file', state: 'unreadable', detail: { key: 'fileUnreadable' } }],
      job: expect.any(String),
      seq: 0,
    })
  })

  it('a Music check that throws reads as unreadable and the job still succeeds', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      verifyMusic: vi.fn(async () => {
        throw new Error('Apple Music did not answer in time')
      }),
    })

    const result = await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(result.musicPersistentId).toBe('added-id')
    expect(result.verification?.checks[1]).toEqual({
      place: 'appleMusic',
      state: 'unreadable',
      detail: { key: 'musicUnreadable' },
    })
  })

  // The toggle is the permission, the path only the address: with sync off no patch is
  // recorded, and Traktor would sit there checking.
  it('Traktor is not listed while its sync is off', async () => {
    const deps = makeDeps({
      settings: settings({ syncTraktor: false, traktorNmlPath: '/t/collection.nml' }),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification?.checks.map((c) => c.place)).toEqual(['file'])
  })

  // The file has landed, the original may be gone and the libraries already point at it:
  // a cancel now can only stop the reads, and the row has to follow the file it wrote.
  it('a cancel during the check returns the conversion with the file unreadable', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      verifyFile: vi.fn(async () => {
        throw errorWithKey('conversionCancelled')
      }),
      registerVerification,
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
    expect(result.verification?.checks).toEqual([
      { place: 'file', state: 'unreadable', detail: { key: 'fileUnreadable' } },
    ])
    expect(registerVerification).toHaveBeenCalledTimes(1)
  })

  it('Music is listed only when the job went through the Music step', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const without = makeDeps({ platform: 'darwin', verifyMusic })
    const plain = await runProcessTrack(job({ meta }), without)
    expect(verifyMusic).not.toHaveBeenCalled()
    expect(plain.verification?.checks.map((c) => c.place)).toEqual(['file'])

    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const withMusic = makeDeps({ platform: 'darwin', verifyMusic, registerVerification })
    const added = await runProcessTrack(job({ meta, addToAppleMusic: true }), withMusic)
    const expected = {
      pid: 'added-id',
      file: '/out/Artist - Title.aiff',
      ext: '.aiff',
      meta: { title: 'Title', artist: 'Artist', album: 'Album' },
      coverSet: false,
    }
    expect(verifyMusic).toHaveBeenCalledWith(expected, expect.any(AbortSignal))
    expect(added.verification?.checks).toEqual([fileOk, musicOk])
    expect(registerVerification.mock.calls[0][0].music).toEqual(expected)
    expect([...registerVerification.mock.calls[0][0].places]).toEqual(['file', 'appleMusic'])
  })

  // The step already said it failed; with no entry to read, the place is not left out as if
  // Music were never asked.
  it('a Music step that failed lists Music as missing', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const deps = makeDeps({
      platform: 'darwin',
      verifyMusic,
      addToAppleMusic: vi.fn(async () => {
        throw new Error('Apple Music did not answer in time')
      }),
    })

    const result = await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(verifyMusic).not.toHaveBeenCalled()
    expect(result.appleMusicFailed).toBe(true)
    expect(result.verification?.checks[1]).toEqual({
      place: 'appleMusic',
      state: 'mismatch',
      detail: { key: 'musicMissing' },
    })
  })

  it("Music only checks the file at the entry's location, not the removed temp", async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
      appleMusicEntryLocation: vi.fn(async () => '/Users/me/Music/Media/Artist - Title.aiff'),
      verifyMusic,
      registerVerification,
    })

    const result = await runProcessTrack(job({ meta }), deps)

    expect(vi.mocked(deps.convertAudio).mock.calls[0][1]).toBe('/tmp/surco-abc/Artist - Title.aiff')
    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/Users/me/Music/Media/Artist - Title.aiff' }),
      expect.any(AbortSignal),
    )
    expect(verifyMusic).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/Users/me/Music/Media/Artist - Title.aiff' }),
      expect.any(AbortSignal),
    )
    expect(registerVerification.mock.calls[0][0].to).toBe(
      '/Users/me/Music/Media/Artist - Title.aiff',
    )
    expect(result.verification?.checks).toEqual([fileOk, musicOk])
  })

  it('Music only checks the location the replaced entry landed at', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
      appleMusicEntryLocation: vi.fn(async () => '/Users/me/Music/Media/Landed.aiff'),
      verifyMusic,
    })

    await runProcessTrack(
      job({
        meta,
        musicPersistentId: 'old-id',
        replacesPath: '/m/old.mp3',
        replacesLabel: 'A - T',
      }),
      deps,
    )

    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/Users/me/Music/Media/Landed.aiff' }),
      expect.any(AbortSignal),
    )
    expect(verifyMusic).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/Users/me/Music/Media/Landed.aiff' }),
      expect.any(AbortSignal),
    )
  })

  it('a replacement hands Music the old entry, its playlists and whether it was kept', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const replace = {
      meta,
      addToAppleMusic: true,
      musicPersistentId: 'old-id',
      replacesPath: '/m/old.mp3',
      replacesLabel: 'A - T',
    }
    const deps = makeDeps({
      platform: 'darwin',
      verifyMusic,
      appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async () => ['24']),
    })
    await runProcessTrack(job(replace), deps)
    expect(verifyMusic).toHaveBeenLastCalledWith(
      expect.objectContaining({ replaced: { oldPid: 'old-id', playlistsBefore: ['24'] } }),
      expect.any(AbortSignal),
    )

    const kept = makeDeps({
      platform: 'darwin',
      verifyMusic,
      appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async () => {
        throw new Error('Apple Music did not answer in time')
      }),
      carryAppleMusicHistory: vi.fn(async () => 'mismatch' as const),
    })
    await runProcessTrack(job(replace), kept)
    expect(verifyMusic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        replaced: { oldPid: 'old-id', playlistsBefore: null, oldKept: true },
      }),
      expect.any(AbortSignal),
    )
  })

  it('an entry found by its file is handed over as the one replaced', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ overwriteOriginal: true }),
      findAppleMusicEntry: vi.fn(async () => ({ persistentId: 'found-id', label: 'A - T' })),
      appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async () => ['All']),
      verifyMusic,
    })

    await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(verifyMusic).toHaveBeenCalledWith(
      expect.objectContaining({ replaced: { oldPid: 'found-id', playlistsBefore: ['All'] } }),
      expect.any(AbortSignal),
    )
  })

  it('an entry in another format is handed over as the one replaced', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const deps = makeDeps({
      platform: 'darwin',
      appleMusicEntry: vi.fn(async () => ({ path: '/lib/A.mp3', label: 'A - T' })),
      appleMusicPlaylists: vi.fn<ProcessTrackDeps['appleMusicPlaylists']>(async () => ['24']),
      verifyMusic,
    })

    await runProcessTrack(job({ meta, addToAppleMusic: true, musicPersistentId: 'PID' }), deps)

    expect(verifyMusic).toHaveBeenCalledWith(
      expect.objectContaining({ replaced: { oldPid: 'PID', playlistsBefore: ['24'] } }),
      expect.any(AbortSignal),
    )
  })

  it('a cover put on the file is expected in the file and in Music', async () => {
    const verifyMusic = vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>(async () => musicOk)
    const deps = makeDeps({ platform: 'darwin', hasCoverSource: vi.fn(() => true), verifyMusic })

    await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ cover: 'written' }),
      expect.any(AbortSignal),
    )
    expect(verifyMusic).toHaveBeenCalledWith(
      expect.objectContaining({ coverSet: true }),
      expect.any(AbortSignal),
    )
  })

  it('a job that leaves the cover alone expects it untouched', async () => {
    const deps = makeDeps()

    await runProcessTrack(job(), deps)

    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ cover: 'untouched' }),
      expect.any(AbortSignal),
    )
  })

  it('Traktor is marked stranded when its entry could not follow the landed file', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({
        addToAppleMusic: true,
        keepOutputCopy: false,
        syncTraktor: true,
        traktorNmlPath: '/t/collection.nml',
      }),
      redirectRepoint: vi.fn(() => false),
      registerVerification,
    })

    await runProcessTrack(job({ meta }), deps)

    expect(registerVerification.mock.calls[0][0].traktorStranded).toBe(true)
  })

  // Music copies the file into its Media folder when its preference says so, and then
  // plays that copy: the entry is held to the copy, the file check to what was written.
  const MEDIA = '/Users/me/Music/Media'
  const copy = `${MEDIA}/Music/Artist/Album/Artist - Title.aiff`
  const inMedia = (over: Partial<ProcessTrackDeps> = {}) =>
    makeDeps({
      platform: 'darwin',
      appleMusicMediaFolder: vi.fn(async () => MEDIA),
      appleMusicEntryLocation: vi.fn(async () => copy),
      ...over,
    })
  const heldTo = (deps: ProcessTrackDeps) => vi.mocked(deps.verifyMusic).mock.calls[0][0].file

  it('Music is held to its Media folder copy when it made one, the file to the written one', async () => {
    const deps = inMedia()

    await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(heldTo(deps)).toBe(copy)
    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/out/Artist - Title.aiff' }),
      expect.any(AbortSignal),
    )
  })

  // Retagging an entry never moves it: it keeps playing its old Media file, which is not
  // the conversion, however much it looks like Music's own copy.
  it('a retagged entry on an older Media file is held to the written file', async () => {
    const deps = inMedia({
      appleMusicEntry: vi.fn(async () => ({ path: copy, label: 'Artist - Title' })),
    })

    await runProcessTrack(
      job({ meta, addToAppleMusic: true, musicPersistentId: 'updated-id' }),
      deps,
    )

    expect(deps.updateInAppleMusic).toHaveBeenCalled()
    expect(heldTo(deps)).toBe('/out/Artist - Title.aiff')
  })

  // A replacement's new entry is this job's own import, so its Media copy is the one.
  it('a replacement is held to the Media copy its add answered with', async () => {
    const deps = inMedia()

    await runProcessTrack(
      job({ meta, addToAppleMusic: true, musicPersistentId: 'old-id', replacesPath: '/m/old.mp3' }),
      deps,
    )

    expect(heldTo(deps)).toBe(copy)
  })

  // An update that finds its entry gone falls back to an add: only that add's entry counts.
  it('an entry this job did not add is held to the written file', async () => {
    const deps = inMedia({ updateInAppleMusic: vi.fn(async () => 'kept-id') })

    await runProcessTrack(job({ meta, addToAppleMusic: true, musicPersistentId: 'kept-id' }), deps)

    expect(deps.addToAppleMusic).not.toHaveBeenCalled()
    expect(heldTo(deps)).toBe('/out/Artist - Title.aiff')
  })

  it('an in-place rewrite whose entry was gone is held to the Media copy of its add', async () => {
    const deps = inMedia({
      settings: settings({ overwriteOriginal: true }),
      isSameFile: vi.fn(async () => true),
      findAppleMusicEntry: vi.fn(async () => ({ persistentId: 'gone-id', label: 'A - T' })),
      updateInAppleMusic: vi.fn(async () => null),
    })

    await runProcessTrack(
      job({ meta, addToAppleMusic: true, inputPath: '/in/song.aiff', format: 'aiff' }),
      deps,
    )

    expect(deps.addToAppleMusic).toHaveBeenCalled()
    expect(heldTo(deps)).toBe(copy)
  })

  it('the Media folder is compared where it really lands', async () => {
    const deps = inMedia({
      appleMusicMediaFolder: vi.fn(async () => '/Users/me/Music/Link'),
      realPath: (p: string) => p.replace('/Users/me/Music/Link', MEDIA),
    })

    await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(heldTo(deps)).toBe(copy)
  })

  it('an entry on a file outside the Media folder is still held to the written file', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      appleMusicMediaFolder: vi.fn(async () => '/Users/me/Music/Media'),
      appleMusicEntryLocation: vi.fn(async () => '/Volumes/Old/Artist - Title.mp3'),
    })

    await runProcessTrack(job({ meta, addToAppleMusic: true }), deps)

    expect(deps.verifyMusic).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/out/Artist - Title.aiff' }),
      expect.any(AbortSignal),
    )
  })

  // Music fills a fresh entry's location late: an empty one at the add is read again.
  it('Music only reads the entry again when the add gave no location', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
      appleMusicEntryLocation: vi
        .fn<ProcessTrackDeps['appleMusicEntryLocation']>()
        .mockResolvedValueOnce('')
        .mockResolvedValue('/Users/me/Music/Media/Late.aiff'),
    })

    await runProcessTrack(job({ meta }), deps)

    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/Users/me/Music/Media/Late.aiff' }),
      expect.any(AbortSignal),
    )
  })

  it('Music only with no location at all is a missing file, and the job still lands', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
      appleMusicEntryLocation: vi.fn(async () => ''),
      registerVerification,
    })

    const result = await runProcessTrack(job({ meta }), deps)

    expect(result.addedToMusicOnly).toBe(true)
    expect(deps.verifyFile).not.toHaveBeenCalled()
    expect(result.verification?.checks[0]).toEqual({
      place: 'file',
      state: 'mismatch',
      detail: { key: 'fileMissing' },
    })
  })

  // The repoints were recorded on the temp, which is deleted by now: a location read late
  // moves them to the file Music plays, or the libraries would be pointed at nothing.
  it('Music only points the libraries at a location read late', async () => {
    const redirectRepoint = vi.fn<NonNullable<ProcessTrackDeps['redirectRepoint']>>(() => false)
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({ addToAppleMusic: true, keepOutputCopy: false }),
      appleMusicEntryLocation: vi
        .fn<ProcessTrackDeps['appleMusicEntryLocation']>()
        .mockResolvedValueOnce('')
        .mockResolvedValue('/Users/me/Music/Media/Late.aiff'),
      redirectRepoint,
      registerVerification,
    })

    await runProcessTrack(job({ meta }), deps)

    expect(redirectRepoint).toHaveBeenCalledWith(
      expect.stringMatching(/Artist - Title\.aiff$/),
      '/Users/me/Music/Media/Late.aiff',
    )
    expect(registerVerification.mock.calls[0][0].traktorStranded).toBe(true)
  })

  // With no file to follow, what the libraries hold cannot be judged: their repoints still
  // name the deleted temp.
  it('Music only with no location lists the libraries as unreadable, not as checking', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      platform: 'darwin',
      settings: settings({
        addToAppleMusic: true,
        keepOutputCopy: false,
        syncTraktor: true,
        traktorNmlPath: '/t/collection.nml',
      }),
      appleMusicEntryLocation: vi.fn(async () => ''),
      snapshotLibraries: vi.fn<NonNullable<ProcessTrackDeps['snapshotLibraries']>>(async () => ({
        rekordbox: snapshot,
      })),
      registerVerification,
    })

    const result = await runProcessTrack(job({ meta }), deps)

    const states = result.verification?.checks.map((c) => [c.place, c.state, c.detail.key])
    expect(states).toContainEqual(['rekordbox', 'unreadable', 'rekordboxUnreadable'])
    expect(states).toContainEqual(['traktor', 'unreadable', 'traktorUnreadable'])
    const entry = registerVerification.mock.calls[0][0]
    expect(entry.places.has('rekordbox')).toBe(false)
    expect(entry.places.has('traktor')).toBe(false)
  })

  it('a cancel while the job reads back what it wrote stops the reads, not the job', async () => {
    const active = createActiveConversions()
    let reading: () => void = () => {}
    const started = new Promise<void>((resolve) => (reading = resolve))
    const aborted = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        reading()
        signal.addEventListener('abort', () => reject(errorWithKey('conversionCancelled')))
      })
    const deps = makeDeps({
      platform: 'darwin',
      beginJob: active.beginJob,
      endJob: active.endJob,
      registerActiveConversion: active.register,
      unregisterActiveConversion: active.unregister,
      verifyFile: vi.fn<ProcessTrackDeps['verifyFile']>((_e, signal) => aborted(signal)),
      verifyMusic: vi.fn<NonNullable<ProcessTrackDeps['verifyMusic']>>((_e, signal) =>
        aborted(signal),
      ),
    })

    const running = runProcessTrack(job({ meta, addToAppleMusic: true }), deps)
    await started
    expect(active.cancel('job1')).toBe(true)

    const result = await running
    expect(result.musicPersistentId).toBe('added-id')
    expect(result.verification?.checks.map((c) => [c.place, c.state, c.detail.key])).toEqual([
      ['file', 'unreadable', 'fileUnreadable'],
      ['appleMusic', 'unreadable', 'musicUnreadable'],
    ])
    expect(active.count()).toBe(0)
  })

  // Once the job has reported back there is nothing left for a cancel to stop.
  it('a finished job leaves nothing registered for a cancel to reach', async () => {
    const active = createActiveConversions()
    const deps = makeDeps({
      beginJob: active.beginJob,
      endJob: active.endJob,
      registerActiveConversion: active.register,
      unregisterActiveConversion: active.unregister,
    })

    await runProcessTrack(job(), deps)

    expect(active.cancel('job1')).toBe(false)
  })

  it('hands the check the decode convertAudio already proved', async () => {
    const proven = { size: 10, mtimeMs: 1, ino: 2, durationSec: 2 }
    const deps = makeDeps({
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async () => ({
        normalizeSkipped: false,
        written: { ...written, proven },
      })),
    })

    await runProcessTrack(job(), deps)

    expect(deps.verifyFile).toHaveBeenCalledWith(
      expect.objectContaining({ proven }),
      expect.any(AbortSignal),
    )
  })

  it('a cancel that landed during the conversion stops the reads before they start', async () => {
    const active = createActiveConversions()
    const deps = makeDeps({
      beginJob: active.beginJob,
      endJob: active.endJob,
      registerActiveConversion: active.register,
      unregisterActiveConversion: active.unregister,
      convertAudio: vi.fn<ProcessTrackDeps['convertAudio']>(async () => {
        active.cancel('job1')
        return { normalizeSkipped: false, written }
      }),
      verifyFile: vi.fn<ProcessTrackDeps['verifyFile']>(async (_e, signal) => {
        if (signal.aborted) throw errorWithKey('conversionCancelled')
        return new Promise(() => {})
      }),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification?.checks).toEqual([
      { place: 'file', state: 'unreadable', detail: { key: 'fileUnreadable' } },
    ])
  })

  it('libraries that could not be read before converting are unreadable, not skipped', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      snapshotLibraries: vi.fn<NonNullable<ProcessTrackDeps['snapshotLibraries']>>(async () => {
        throw new Error('SQLITE_BUSY')
      }),
      registerVerification,
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.outputPath).toBe('/out/Artist - Title.aiff')
    expect(registerVerification.mock.calls[0][0]).toMatchObject({
      rekordbox: 'unreadable',
      engine: 'unreadable',
    })
    expect(result.verification?.checks.map((c) => c.place)).toEqual(['file', 'rekordbox', 'engine'])
  })

  // The Engine DJ destination writes its row during the job: a source Engine did not have
  // still leaves a row to check.
  it.each([
    ['no snapshot', undefined],
    ['a source Engine did not have', 'absent' as const],
  ])('an Engine row the job added is listed with %s', async (_, engine) => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
      snapshotLibraries: vi.fn<NonNullable<ProcessTrackDeps['snapshotLibraries']>>(async () =>
        engine ? { engine } : {},
      ),
      registerVerification,
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification?.checks.map((c) => c.place)).toEqual(['file', 'engine'])
    expect(registerVerification.mock.calls[0][0].engineStep).toBe(true)
    expect([...registerVerification.mock.calls[0][0].places]).toContain('engine')
  })

  it('an Engine add that failed lists no Engine row to check', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
      addToEngineDj: vi.fn(async () => {
        throw new Error('database is locked')
      }),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification?.checks.map((c) => c.place)).toEqual(['file'])
  })

  // The libraries followed the copy replaced; only the file converted can be converted again.
  it('a swap registers the replaced copy for the libraries and the converted file as source', async () => {
    const registerVerification = vi.fn<NonNullable<ProcessTrackDeps['registerVerification']>>()
    const deps = makeDeps({ registerVerification })

    await runProcessTrack(job({ replacesPath: '/m/old.mp3' }), deps)

    expect(registerVerification.mock.calls[0][0]).toMatchObject({
      from: '/m/old.mp3',
      source: '/in/song.wav',
    })
  })

  it('the snapshot is taken before convertAudio runs', async () => {
    const snapshotLibraries = vi.fn<NonNullable<ProcessTrackDeps['snapshotLibraries']>>(
      async () => ({ rekordbox: snapshot }),
    )
    const deps = makeDeps({ snapshotLibraries })

    await runProcessTrack(job({ replacesPath: '/m/old.mp3' }), deps)

    expect(snapshotLibraries).toHaveBeenCalledWith('/m/old.mp3')
    expect(snapshotLibraries.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.convertAudio).mock.invocationCallOrder[0],
    )
  })

  it('the verify stage is sent after the Engine stage', async () => {
    const deps = makeDeps({
      settings: settings({ addToEngineDj: true }),
      prepareProcessedCover: vi.fn(async () => undefined),
    })
    const order: string[] = []
    deps.verifyFile = vi.fn(async () => {
      order.push('verifyFile')
      return fileOk
    })
    deps.sendProgress = vi.fn((stage) => {
      order.push(stage)
    })

    await runProcessTrack(job(), deps)

    expect(order).toEqual(['converting', 'engineDj', 'verify', 'verifyFile'])
  })

  it('a skipped job checks nothing', async () => {
    const deps = makeDeps({
      existsSync: vi.fn(() => true),
      confirmConflict: vi.fn(async () => 'skip' as const),
    })

    const result = await runProcessTrack(job(), deps)

    expect(result.verification).toBeUndefined()
    expect(deps.verifyFile).not.toHaveBeenCalled()
  })
})
